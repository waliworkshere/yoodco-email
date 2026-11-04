import Link from "next/link";
import type { Campaign, CampaignStep, EnrollmentStatus, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { simulate, stopContact } from "@/app/actions/campaigns";
import { Empty, EnrollmentBadge, enrollmentLabel, fmtDate, fmtNum } from "@/components/ui";

const PAGE = 50;
const SIMULATIONS = [
  ["open", "An open"],
  ["click", "A click"],
  ["reply", "An interested reply"],
  ["reply_question", "A question"],
  ["reply_not", "A not-interested reply"],
  ["reply_unsub", "\"Please remove me\""],
  ["meeting", "A meeting booking"],
  ["bounce", "A bounce"],
] as const;
const STATUSES: EnrollmentStatus[] = ["QUEUED", "ACTIVE", "COMPLETED", "REPLIED", "MEETING", "BOUNCED", "UNSUBSCRIBED", "STOPPED", "FAILED"];

export async function ContactsTab({ campaign, sp }: { campaign: Campaign & { steps: CampaignStep[] }; sp: Record<string, string> }) {
  const id = campaign.id;
  const status = STATUSES.includes(sp.status as EnrollmentStatus) ? (sp.status as EnrollmentStatus) : undefined;
  const q = (sp.q ?? "").trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const where: Prisma.CampaignContactWhereInput = {
    campaignId: id,
    ...(status ? { status } : {}),
    ...(q
      ? { OR: [{ contact: { email: { contains: q, mode: "insensitive" } } }, { contact: { company: { contains: q, mode: "insensitive" } } }, { contact: { firstName: { contains: q, mode: "insensitive" } } }, { contact: { lastName: { contains: q, mode: "insensitive" } } }] }
      : {}),
  };
  const [rows, total, counts] = await Promise.all([
    db.campaignContact.findMany({
      where,
      include: {
        contact: true,
        mailbox: { select: { email: true } },
        messages: { where: { status: "SENT" }, select: { firstOpenedAt: true, firstClickedAt: true } },
      },
      orderBy: [{ updatedAt: "desc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
    db.campaignContact.count({ where }),
    db.campaignContact.groupBy({ by: ["status"], where: { campaignId: id }, _count: { _all: true } }),
  ]);
  const countOf = (s: string) => counts.find((c) => c.status === s)?._count._all ?? 0;
  const all = counts.reduce((n, c) => n + c._count._all, 0);
  const isTest = campaign.mode === "TEST";
  const back = `/campaigns/${id}?tab=contacts${status ? `&status=${status}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}${page > 1 ? `&page=${page}` : ""}`;
  const link = (params: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ tab: "contacts" });
    for (const [k, v] of Object.entries({ status, q: q || undefined, ...params })) if (v) p.set(k, v);
    return `/campaigns/${id}?${p}`;
  };
  const pages = Math.max(1, Math.ceil(total / PAGE));

  return (
    <section className="card">
      <div className="filters">
        <Link className="chip" href={link({ status: undefined, page: undefined })} aria-current={!status ? "true" : undefined}>All<span className="n">{fmtNum(all)}</span></Link>
        {STATUSES.filter((s) => countOf(s) > 0).map((s) => (
          <Link key={s} className="chip" href={link({ status: s, page: undefined })} aria-current={status === s ? "true" : undefined}>
            {enrollmentLabel(s)}<span className="n">{fmtNum(countOf(s))}</span>
          </Link>
        ))}
        <form style={{ marginLeft: "auto" }}>
          <input type="hidden" name="tab" value="contacts" />
          {status ? <input type="hidden" name="status" value={status} /> : null}
          <input className="input" type="search" name="q" defaultValue={q} placeholder="Search name, email, company" aria-label="Search contacts" />
        </form>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Contact</th><th>Sender</th><th>Status</th><th>Progress</th><th>Next email</th><th>Engagement</th><th className="r">Actions</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const opened = r.messages.some((m) => m.firstOpenedAt);
                const clicked = r.messages.some((m) => m.firstClickedAt);
                return (
                  <tr key={r.id}>
                    <td>
                      <div className="cell-main">{[r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || r.contact.email}</div>
                      <div className="cell-sub">{r.contact.email}{r.contact.company ? ` · ${r.contact.company}` : ""}</div>
                    </td>
                    <td className="small">{r.mailbox?.email ?? <span className="muted">{r.senderEmail ? `${r.senderEmail} (not connected)` : "Unassigned"}</span>}</td>
                    <td>
                      <EnrollmentBadge status={r.status} />
                      {r.stoppedReason ? <div className="cell-sub">{r.stoppedReason}</div> : null}
                      {r.lastError && r.status !== "COMPLETED" ? <div className="cell-sub" style={{ color: "var(--bad)" }} title={r.lastError}>Last error: {r.lastError.slice(0, 60)}</div> : null}
                    </td>
                    <td className="num nowrap">{r.currentStep} / {campaign.steps.length}</td>
                    <td className="small nowrap">{r.nextStepAt && ["QUEUED", "ACTIVE"].includes(r.status) ? fmtDate(r.nextStepAt) : "–"}</td>
                    <td className="nowrap small">
                      {clicked ? <span className="badge info plain">Clicked</span> : opened ? <span className="badge plain">Opened</span> : <span className="muted">–</span>}
                    </td>
                    <td className="r">
                      <details className="menu">
                        <summary className="btn btn-sm">Actions</summary>
                        <div className="menu-pop">
                          {isTest && r.currentStep > 0 ? (
                            <>
                              <span className="menu-label">Simulate (test only)</span>
                              {SIMULATIONS.map(([w, label]) => (
                                <form action={simulate} key={w}>
                                  <input type="hidden" name="ccId" value={r.id} />
                                  <input type="hidden" name="what" value={w} />
                                  <input type="hidden" name="back" value={back} />
                                  <button className="menu-item" type="submit">{label}</button>
                                </form>
                              ))}
                            </>
                          ) : null}
                          {["QUEUED", "ACTIVE"].includes(r.status) ? (
                            <form action={stopContact}>
                              <input type="hidden" name="ccId" value={r.id} />
                              <input type="hidden" name="back" value={back} />
                              <button className="menu-item danger" type="submit">Stop sequence</button>
                            </form>
                          ) : null}
                          <Link className="menu-item" href={`/campaigns/${id}?tab=emails&contact=${r.id}`}>View emails</Link>
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title="No contacts match">Try another filter or search.</Empty>
      )}
      {pages > 1 ? (
        <div className="pagination">
          <span>Page {page} of {pages} · {fmtNum(total)} contacts</span>
          <span className="row">
            {page > 1 ? <Link className="btn btn-sm" href={link({ page: String(page - 1) })}>Previous</Link> : null}
            {page < pages ? <Link className="btn btn-sm" href={link({ page: String(page + 1) })}>Next</Link> : null}
          </span>
        </div>
      ) : null}
    </section>
  );
}
