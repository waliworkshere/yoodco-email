import ExcelJS from "exceljs";
import Papa from "papaparse";

/**
 * Reads a contact sheet (.xlsx or .csv). Built around the existing Yood format:
 *   companyName | firstName | lastName | recipientEmail | senderEmail | Email1_Subject | Email1_Body | Email2_Subject | …
 * Column names are matched loosely ("Recipient Email", "email", "E-mail" all work).
 * Any other column becomes a {{placeholder}} usable in templates.
 */

export interface ImportedRow {
  rowNumber: number; // as shown in Excel (header = 1)
  email: string;
  firstName: string;
  lastName: string;
  company: string;
  senderEmail: string;
  steps: { subject: string; body: string }[];
  variables: Record<string, string>;
}

export interface ImportResult {
  rows: ImportedRow[];
  stepCount: number;
  columns: { original: string; mappedTo: string }[];
  invalid: { rowNumber: number; reason: string }[];
  duplicates: { rowNumber: number; email: string }[];
  senders: Record<string, number>;
}

const EMAIL_RE = /^[^\s@<>()",;:]+@[^\s@<>()",;:]+\.[a-z]{2,}$/i;

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");

const FIELD_ALIASES: Record<string, string[]> = {
  email: ["recipientemail", "email", "emailaddress", "recipient", "to", "workemail", "contactemail"],
  firstName: ["firstname", "first", "givenname"],
  lastName: ["lastname", "last", "surname", "familyname"],
  company: ["companyname", "company", "organization", "organisation", "account"],
  senderEmail: ["senderemail", "sender", "from", "fromemail", "mailbox", "sendingemail"],
};

type Mapping = { kind: "field"; field: string } | { kind: "step"; step: number; part: "subject" | "body" } | { kind: "var"; name: string };

export function mapHeader(header: string): Mapping {
  const n = norm(header);
  for (const [field, aliases] of Object.entries(FIELD_ALIASES)) if (aliases.includes(n)) return { kind: "field", field };
  const m = n.match(/^(?:email|step|e)(\d{1,2})(subject|subjectline|body|text|content)$/);
  if (m) return { kind: "step", step: Number(m[1]), part: m[2].startsWith("subject") ? "subject" : "body" };
  if (n === "subject") return { kind: "step", step: 1, part: "subject" };
  if (n === "body") return { kind: "step", step: 1, part: "body" };
  const name = header.trim().replace(/[^\w]+/g, "_").replace(/^_|_$/g, "") || "column";
  return { kind: "var", name };
}

function cellText(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    const o = v as Record<string, unknown>;
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join("");
    if ("text" in o && typeof o.text === "string") return o.text;
    if ("hyperlink" in o) return String(o.hyperlink).replace(/^mailto:/, "");
    if ("result" in o) return cellText(o.result);
  }
  return String(v);
}

async function readTable(buf: Buffer, filename: string): Promise<string[][]> {
  if (/\.csv$|\.txt$/i.test(filename)) {
    const text = buf.toString("utf8").replace(/^﻿/, "");
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" });
    return parsed.data.map((r) => r.map((c) => String(c ?? "")));
  }
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.worksheets.find((w) => w.actualRowCount > 0);
  if (!ws) return [];
  const out: string[][] = [];
  const width = ws.columnCount;
  ws.eachRow({ includeEmpty: true }, (row, n) => {
    const cells: string[] = [];
    for (let c = 1; c <= width; c++) cells.push(cellText(row.getCell(c).value));
    out[n - 1] = cells;
  });
  return Array.from(out, (r) => r ?? []);
}

export async function parseContactSheet(buf: Buffer, filename: string): Promise<ImportResult> {
  const table = await readTable(buf, filename);
  const headerIdx = table.findIndex((r) => r.some((c) => c.trim()));
  if (headerIdx === -1) throw new Error("The file is empty.");
  const headers = table[headerIdx].map((h) => h.trim());
  const maps = headers.map(mapHeader);

  if (!maps.some((m) => m.kind === "field" && m.field === "email")) {
    throw new Error(`No recipient email column found. Expected a column named "recipientEmail" or "email". Found: ${headers.filter(Boolean).join(", ")}`);
  }

  const stepCount = Math.max(0, ...maps.map((m) => (m.kind === "step" ? m.step : 0)));
  const result: ImportResult = {
    rows: [],
    stepCount,
    columns: headers
      .map((h, i) => {
        const m = maps[i];
        const mappedTo = m.kind === "field" ? m.field : m.kind === "step" ? `Email ${m.step} ${m.part}` : `{{${m.name}}}`;
        return { original: h, mappedTo };
      })
      .filter((c) => c.original),
    invalid: [],
    duplicates: [],
    senders: {},
  };
  const seen = new Set<string>();

  for (let r = headerIdx + 1; r < table.length; r++) {
    const cells = table[r] ?? [];
    if (!cells.some((c) => c && c.trim())) continue;
    const row: ImportedRow = {
      rowNumber: r + 1,
      email: "",
      firstName: "",
      lastName: "",
      company: "",
      senderEmail: "",
      steps: Array.from({ length: stepCount }, () => ({ subject: "", body: "" })),
      variables: {},
    };
    maps.forEach((m, i) => {
      const raw = cells[i] ?? "";
      if (m.kind === "field") (row as unknown as Record<string, string>)[m.field] = raw.trim();
      else if (m.kind === "step") row.steps[m.step - 1][m.part] = raw.replace(/\r\n/g, "\n").trim();
      else if (headers[i] && raw.trim()) row.variables[m.name] = raw.trim();
    });
    row.email = row.email.toLowerCase().replace(/^mailto:/, "");
    row.senderEmail = row.senderEmail.toLowerCase();

    if (!row.email) {
      result.invalid.push({ rowNumber: row.rowNumber, reason: "Missing recipient email" });
      continue;
    }
    if (!EMAIL_RE.test(row.email)) {
      result.invalid.push({ rowNumber: row.rowNumber, reason: `Invalid email "${row.email}"` });
      continue;
    }
    if (row.senderEmail && !EMAIL_RE.test(row.senderEmail)) {
      result.invalid.push({ rowNumber: row.rowNumber, reason: `Invalid sender email "${row.senderEmail}"` });
      continue;
    }
    if (seen.has(row.email)) {
      result.duplicates.push({ rowNumber: row.rowNumber, email: row.email });
      continue;
    }
    seen.add(row.email);
    if (row.senderEmail) result.senders[row.senderEmail] = (result.senders[row.senderEmail] ?? 0) + 1;
    result.rows.push(row);
  }
  return result;
}

/** Round-robin assignment for contacts whose sender is not connected (or not given). */
export function assignRoundRobin<T>(items: T[], mailboxIds: string[], offset = 0): Map<T, string> {
  const out = new Map<T, string>();
  if (!mailboxIds.length) return out;
  items.forEach((it, i) => out.set(it, mailboxIds[(i + offset) % mailboxIds.length]));
  return out;
}
