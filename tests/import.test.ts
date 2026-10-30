import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { mapHeader, parseContactSheet } from "@/lib/import";

describe("column mapping", () => {
  it("understands the existing sheet's headers", () => {
    expect(mapHeader("recipientEmail")).toEqual({ kind: "field", field: "email" });
    expect(mapHeader("Recipient Email")).toEqual({ kind: "field", field: "email" });
    expect(mapHeader("senderEmail")).toEqual({ kind: "field", field: "senderEmail" });
    expect(mapHeader("Email2_Subject")).toEqual({ kind: "step", step: 2, part: "subject" });
    expect(mapHeader("Email 3 Body")).toEqual({ kind: "step", step: 3, part: "body" });
    expect(mapHeader("Industry")).toEqual({ kind: "var", name: "Industry" });
  });
});

describe("parseContactSheet (CSV)", () => {
  it("parses rows, validates, de-duplicates and counts senders", async () => {
    const r = await parseContactSheet(readFileSync("tests/fixtures/sample-contacts.csv"), "sample.csv");
    expect(r.stepCount).toBe(3);
    expect(r.rows.map((x) => x.email)).toEqual(["ava.stone@northwind.example", "liam.park@northwind.example", "zoe@fabrikam.example"]);
    expect(r.invalid).toEqual([{ rowNumber: 4, reason: 'Invalid email "not-an-email"' }]);
    expect(r.duplicates.map((d) => d.email)).toEqual(["ava.stone@northwind.example"]);
    expect(r.senders).toEqual({ "charles@yood.ai": 1, "katy@yood.ai": 1 });
    expect(r.rows[0].steps[0].body).toContain("Saw what {{companyName}}");
    expect(r.rows[0].variables).toEqual({ industry: "SaaS" });
    expect(r.rows[1].variables).toEqual({ industry: "logistics" });
  });
});

describe("parseContactSheet (XLSX)", () => {
  it("reads an Excel file in the Yood layout", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Sheet1");
    ws.addRow(["companyName", "firstName", "lastName", "recipientEmail", "senderEmail", "Email1_Subject", "Email1_Body", "Email2_Subject", "Email2_Body"]);
    ws.addRow(["Insly", "Risto", "R", "risto@insly.example", "charles@yood.ai", "Subject 1", "Hi Risto,\n\nBody", "Subject 2", "Body 2"]);
    ws.addRow([{ richText: [{ text: "Rich" }, { text: "Co" }] }, "Ana", "B", { text: "ana@rich.example", hyperlink: "mailto:ana@rich.example" }, "katy@yood.ai", "S", "B", "", ""]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());
    const r = await parseContactSheet(buf, "list.xlsx");
    expect(r.stepCount).toBe(2);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].steps[0]).toEqual({ subject: "Subject 1", body: "Hi Risto,\n\nBody" });
    expect(r.rows[1].company).toBe("RichCo");
    expect(r.rows[1].email).toBe("ana@rich.example");
  });
  it("explains a missing email column", async () => {
    await expect(parseContactSheet(Buffer.from("name,company\nA,B\n"), "x.csv")).rejects.toThrow(/No recipient email column/);
  });
});
