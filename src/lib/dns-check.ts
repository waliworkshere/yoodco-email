import { resolveTxt, resolveMx } from "node:dns/promises";

/**
 * Deliverability basics for a sending domain. Missing SPF/DKIM/DMARC is the
 * most common reason careful senders still land in spam.
 */
export interface DomainCheck {
  domain: string;
  mx: { ok: boolean; detail: string };
  spf: { ok: boolean; detail: string };
  dmarc: { ok: boolean; detail: string };
  dkim: { ok: boolean; detail: string };
}

async function txt(name: string) {
  try {
    return (await resolveTxt(name)).map((r) => r.join(""));
  } catch {
    return [];
  }
}

export async function checkDomain(domain: string, provider: string): Promise<DomainCheck> {
  const [mx, root, dmarc] = await Promise.all([resolveMx(domain).catch(() => []), txt(domain), txt(`_dmarc.${domain}`)]);
  const spf = root.find((r) => r.toLowerCase().startsWith("v=spf1"));
  const dm = dmarc.find((r) => r.toLowerCase().startsWith("v=dmarc1"));
  const selectors = provider.startsWith("GOOGLE") ? ["google"] : provider === "MICROSOFT" ? ["selector1", "selector2"] : ["default", "google", "selector1", "k1", "s1", "mail", "dkim"];
  let dkimFound = "";
  for (const s of selectors) {
    const recs = await txt(`${s}._domainkey.${domain}`);
    if (recs.some((r) => /v=DKIM1|k=rsa|p=/i.test(r))) {
      dkimFound = s;
      break;
    }
    // Microsoft publishes DKIM as CNAMEs; resolveTxt follows them
  }
  return {
    domain,
    mx: mx.length ? { ok: true, detail: mx.sort((a, b) => a.priority - b.priority).map((m) => m.exchange).slice(0, 2).join(", ") } : { ok: false, detail: "No MX record: replies cannot reach this domain." },
    spf: spf ? { ok: true, detail: spf } : { ok: false, detail: "No SPF record. Add one that includes your email provider (e.g. include:_spf.google.com)." },
    dmarc: dm
      ? { ok: true, detail: dm }
      : { ok: false, detail: "No DMARC record. Add a TXT record at _dmarc with at least v=DMARC1; p=none; rua=mailto:you@domain." },
    dkim: dkimFound
      ? { ok: true, detail: `Found at selector "${dkimFound}"` }
      : { ok: false, detail: `No DKIM key found at the usual selectors (${selectors.join(", ")}). Turn on DKIM signing in your email provider's admin console.` },
  };
}
