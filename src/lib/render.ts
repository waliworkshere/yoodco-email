/**
 * Turns the plain-text copy from the sheet into the email that is actually sent:
 *  - fills {{placeholders}} (with optional fallback: {{firstName|there}})
 *  - builds a light HTML version that looks like a hand-written email
 *  - rewrites links through the click tracker and adds the open pixel
 *  - appends signature and unsubscribe line
 */

export type Vars = Record<string, string | number | null | undefined>;

export function fillTemplate(template: string, vars: Vars): string {
  const lookup = new Map<string, string>();
  for (const [k, v] of Object.entries(vars)) {
    if (v !== null && v !== undefined && String(v).trim() !== "") lookup.set(k.toLowerCase(), String(v));
  }
  return template.replace(/\{\{\s*([\w.-]+)\s*(?:\|\s*([^}]*?)\s*)?\}\}/g, (_m, name: string, fallback?: string) => {
    return lookup.get(name.toLowerCase()) ?? fallback ?? "";
  });
}

/** Placeholders in a template that have no value for this contact (used for warnings). */
export function missingPlaceholders(template: string, vars: Vars): string[] {
  const missing = new Set<string>();
  const keys = new Set(
    Object.entries(vars)
      .filter(([, v]) => v !== null && v !== undefined && String(v).trim() !== "")
      .map(([k]) => k.toLowerCase()),
  );
  for (const m of template.matchAll(/\{\{\s*([\w.-]+)\s*(\|[^}]*)?\}\}/g)) {
    if (!m[2] && !keys.has(m[1].toLowerCase()) && !["unsubscribeurl", "bookinglink", "bookingurl"].includes(m[1].toLowerCase())) missing.add(m[1]);
  }
  return [...missing];
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/gi;

function trimUrl(url: string): { url: string; trailing: string } {
  let trailing = "";
  while (/[.,;:!?)\]]$/.test(url)) {
    // keep a closing parenthesis that belongs to the URL
    if (url.endsWith(")") && (url.match(/\(/g)?.length ?? 0) >= (url.match(/\)/g)?.length ?? 0)) break;
    trailing = url.slice(-1) + trailing;
    url = url.slice(0, -1);
  }
  return { url, trailing };
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export interface RenderOptions {
  appUrl: string;
  token: string;
  trackOpens: boolean;
  trackClicks: boolean;
  signature?: string | null;
  unsubscribeLine?: string | null; // may contain {{unsubscribeUrl}}
}

export interface RenderedEmail {
  subject: string;
  text: string;
  html: string;
  links: string[];
  unsubscribeUrl: string;
}

export function renderEmail(subjectTpl: string, bodyTpl: string, vars: Vars, opts: RenderOptions): RenderedEmail {
  const unsubscribeUrl = `${opts.appUrl}/u/${opts.token}`;
  const bookingLink = `${opts.appUrl}/b/${opts.token}`;
  const allVars = { ...vars, unsubscribeUrl, bookingLink, bookingUrl: bookingLink };

  const subject = fillTemplate(subjectTpl, allVars).replace(/\s+/g, " ").trim();
  let body = fillTemplate(bodyTpl, allVars).replace(/\r\n/g, "\n").replace(/\s+$/, "");
  if (opts.signature && opts.signature.trim()) body += "\n\n" + fillTemplate(opts.signature.trim(), allVars);

  const footer = opts.unsubscribeLine ? fillTemplate(opts.unsubscribeLine, allVars).trim() : "";
  const text = footer ? `${body}\n\n${footer}\n` : `${body}\n`;

  // Collect distinct links in the body (not the footer) for click tracking
  const links: string[] = [];
  const linkIndex = (url: string) => {
    let i = links.indexOf(url);
    if (i === -1) {
      links.push(url);
      i = links.length - 1;
    }
    return i;
  };

  const toHtml = (src: string, track: boolean) =>
    src
      .split(/\n{2,}/)
      .map((para) => {
        let out = "";
        let last = 0;
        for (const m of para.matchAll(URL_RE)) {
          const { url, trailing } = trimUrl(m[0]);
          out += escapeHtml(para.slice(last, m.index));
          const href = track ? `${opts.appUrl}/t/c/${opts.token}/${linkIndex(url)}` : url;
          out += `<a href="${escapeHtml(href)}" style="color:#1a56db">${escapeHtml(url)}</a>${escapeHtml(trailing)}`;
          last = (m.index ?? 0) + m[0].length;
        }
        out += escapeHtml(para.slice(last));
        return `<p style="margin:0 0 14px 0">${out.replace(/\n/g, "<br>")}</p>`;
      })
      .join("\n");

  const bodyHtml = toHtml(body, opts.trackClicks);
  // body links must be collected even when click tracking is off, so analytics can list them
  if (!opts.trackClicks) for (const m of body.matchAll(URL_RE)) linkIndex(trimUrl(m[0]).url);

  const footerHtml = footer
    ? `<p style="margin:18px 0 0 0;font-size:12px;color:#777">${toHtml(footer, false).replace(/^<p[^>]*>|<\/p>$/g, "")}</p>`
    : "";
  const pixel = opts.trackOpens
    ? `<img src="${opts.appUrl}/t/o/${opts.token}.gif" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0">`
    : "";

  const html = `<!doctype html><html><body style="margin:0;padding:0"><div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#222222">\n${bodyHtml}${footerHtml}${pixel}</div></body></html>`;

  return { subject, text, html, links, unsubscribeUrl };
}
