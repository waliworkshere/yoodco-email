import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { meetingCounts } from "@/lib/stats";
import { sourceLabel } from "@/lib/meetings/record";
import { setMeetingStatus } from "@/app/actions/meetings";
import { Empty, Flash, fmtDate, fmtNum, Kpi, MeetingStatusBadge } from "@/components/ui";

export const metadata = { title: "Meetings" };

const VIEWS = [
  ["upcoming", "Coming up"],
  ["past", "Past"],
  ["all", "All"],
  ["canceled", "Canceled"],
] as const;

export default async function MeetingsPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const view = VIEWS.some(([k]) => k === sp.view) ? sp.view : "upcoming";
  const mode = sp.mode === "TEST" ? "TEST" : "LIVE";
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const base: Prisma.MeetingWhereInput = { mode };
  const where: Prisma.MeetingWhereInput =
    view === "upcoming"
      ? { ...base, status: "BOOKED", OR: [{ startsAt: { gte: new Date(now.getTime() - 3_600_000) } }, { startsAt: null }] }
      : view === "past"
        ? { ...base, status: { not: "CANCELED" }, startsAt: { lt: now } }
        : view === "canceled"
          ? { ...base, status: "CANCELED" }
          : base;

  const [rows, month, total, testCount] = await Promise.all([
    db.meeting.findMany({
      where,
      include: { campaign: { select: { id: true, name: true } } },
      orderBy: view === "upcoming" ? [{ startsAt: { sort: "asc", nulls: "last" } }] : [{ startsAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 300,
    }),
    meetingCounts({ mode, createdAt: { gte: monthStart } }),
    meetingCounts({ mode }),
    db.meeting.count({ where: { mode: "TEST" } }),
  ]);
  const backUrl = `/meetings?view=${view}${mode === "TEST" ? "&mode=TEST" : ""}`;
  const showRate = total.held + total.noShow ? `${Math.round((total.held / (total.held + total.noShow)) * 100)}%` : "–";
  const pastDue = rows.filter((m) => m.status === "BOOKED" && m.startsAt && m.startsAt < now).length;

  return (
    <>
      <div className="page-head">
        <div className="title">
          <h1>Meetings</h1>
          <p className="muted">Every call booked from your campaigns: on the booking page, through Calendly or Cal.com, by calendar invite, or added by hand. Times in {env.displayTimezone.replace(/_/g, " ")}.</p>
        </div>
        <div className="actions">
          {testCount ? (
            <Link className="btn" href={mode === "TEST" ? "/meetings" : "/meetings?mode=TEST"}>{mode === "TEST" ? "Show live meetings" : `Test bookings (${testCount})`}</Link>
          ) : null}
          <a className="btn" href={`/meetings/export${mode === "TEST" ? "?mode=TEST" : ""}`}>Export (.csv)</a>
        </div>
      </div>
      <Flash sp={sp} />
      {mode === "TEST" ? <div className="test-banner"><span><strong>Test bookings.</strong> Made during test runs; never counted in your results.</span></div> : null}

      <div className="kpis">
        <Kpi label="Booked this month" value={fmtNum(month.booked)} sub={now.toLocaleString("en-US", { month: "long" })} highlight />
        <Kpi label="Coming up" value={fmtNum(total.upcoming)} />
        <Kpi label="Held" value={fmtNum(total.held)} sub="all time" />
        <Kpi label="No-shows" value={fmtNum(total.noShow)} />
        <Kpi label="Show rate" value={showRate} sub="held ÷ (held + no-show)" />
      </div>

      <section className="card">
        <div className="filters">
          {VIEWS.map(([k, label]) => (
            <Link key={k} className="chip" href={`/meetings?view=${k}${mode === "TEST" ? "&mode=TEST" : ""}`} aria-current={view === k ? "true" : undefined}>{label}</Link>
          ))}
          {pastDue && view !== "upcoming" ? <span className="small muted" style={{ marginLeft: "auto" }}>{pastDue} past meeting{pastDue === 1 ? "" : "s"} still marked booked: mark them held or no-show.</span> : null}
        </div>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>When</th><th>Who</th><th>Campaign</th><th>Booked via</th><th>Status</th><th className="r">Update</th></tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="nowrap">
                      <div className="cell-main">{m.startsAt ? fmtDate(m.startsAt) : "Time not given"}</div>
                      <div className="cell-sub">Booked {fmtDate(m.createdAt)}</div>
                    </td>
                    <td>
                      <div className="cell-main">{m.name || m.email}</div>
                      <div className="cell-sub">{m.email}{m.company ? ` · ${m.company}` : ""}</div>
                    </td>
                    <td className="small">{m.campaign ? <Link href={`/campaigns/${m.campaign.id}?tab=replies`}>{m.campaign.name}</Link> : <span className="muted">Not matched to a contact</span>}</td>
                    <td className="small nowrap">{sourceLabel(m.source)}{m.hostEmail ? <div className="cell-sub">with {m.hostEmail}</div> : null}</td>
                    <td><MeetingStatusBadge status={m.status} /></td>
                    <td className="r">
                      <div className="row" style={{ gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                        {(m.status === "BOOKED" ? (["HELD", "NO_SHOW", "CANCELED"] as const) : m.status === "CANCELED" ? ([] as const) : (["BOOKED"] as const)).map((st) => (
                          <form key={st} action={setMeetingStatus}>
                            <input type="hidden" name="meetingId" value={m.id} />
                            <input type="hidden" name="status" value={st} />
                            <input type="hidden" name="back" value={backUrl} />
                            <button className="btn btn-sm" type="submit">{st === "HELD" ? "Held" : st === "NO_SHOW" ? "No-show" : st === "CANCELED" ? "Cancel" : "Undo"}</button>
                          </form>
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty title={view === "upcoming" ? "No meetings coming up" : "No meetings here yet"}>
            When an interested contact picks a time, the meeting appears here and in your calendar.
          </Empty>
        )}
      </section>
    </>
  );
}
