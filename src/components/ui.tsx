import type { ReactNode } from "react";
import { env } from "@/lib/env";
import { IconAlert, IconCheck, IconFlask, IconInfo } from "./icons";

export function fmtDate(d: Date | null | undefined, withTime = true) {
  if (!d) return "–";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: env.displayTimezone,
    day: "numeric",
    month: "short",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" as const } : { year: "numeric" as const }),
  }).format(d);
}

export function fmtRelative(d: Date | null | undefined) {
  if (!d) return "–";
  const s = Math.round((d.getTime() - Date.now()) / 1000);
  const abs = Math.abs(s);
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 60) return rtf.format(s, "second");
  if (abs < 3600) return rtf.format(Math.round(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(s / 3600), "hour");
  return rtf.format(Math.round(s / 86400), "day");
}

export const fmtNum = (n: number) => n.toLocaleString("en-US");

type Tone = "good" | "warn" | "bad" | "info" | "test" | "neutral";

export function Badge({ tone = "neutral", children, plain }: { tone?: Tone; children: ReactNode; plain?: boolean }) {
  return <span className={`badge ${tone === "neutral" ? "" : tone} ${plain ? "plain" : ""}`}>{children}</span>;
}

const CAMPAIGN: Record<string, [Tone, string]> = {
  DRAFT: ["neutral", "Draft"],
  RUNNING: ["good", "Running"],
  PAUSED: ["warn", "Paused"],
  COMPLETED: ["info", "Completed"],
};
export const CampaignStatusBadge = ({ status }: { status: string }) => {
  const [tone, label] = CAMPAIGN[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
};
export const ModeBadge = ({ mode }: { mode: string }) =>
  mode === "TEST" ? <Badge tone="test" plain>Test mode</Badge> : <Badge tone="info" plain>Live</Badge>;

const ENROLLMENT: Record<string, [Tone, string]> = {
  QUEUED: ["neutral", "Queued"],
  ACTIVE: ["info", "In sequence"],
  COMPLETED: ["neutral", "Finished"],
  REPLIED: ["good", "Replied"],
  BOUNCED: ["bad", "Bounced"],
  UNSUBSCRIBED: ["warn", "Unsubscribed"],
  STOPPED: ["warn", "Stopped"],
  FAILED: ["bad", "Failed"],
};
export const EnrollmentBadge = ({ status }: { status: string }) => {
  const [tone, label] = ENROLLMENT[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
};
export const enrollmentLabel = (s: string) => ENROLLMENT[s]?.[1] ?? s;

const MAILBOX: Record<string, [Tone, string]> = {
  ACTIVE: ["good", "Active"],
  PAUSED: ["warn", "Paused"],
  AUTO_PAUSED: ["bad", "Auto-paused"],
  ERROR: ["bad", "Needs attention"],
};
export const MailboxStatusBadge = ({ status }: { status: string }) => {
  const [tone, label] = MAILBOX[status] ?? ["neutral", status];
  return <Badge tone={tone}>{label}</Badge>;
};

export const PROVIDER_LABEL: Record<string, string> = {
  GOOGLE: "Google",
  GOOGLE_DWD: "Google Workspace (admin)",
  MICROSOFT: "Microsoft 365",
  SMTP: "SMTP / IMAP",
  SANDBOX: "Sandbox",
};

export function Notice({ tone = "info", title, children }: { tone?: "info" | "good" | "warn" | "bad" | "test"; title?: ReactNode; children?: ReactNode }) {
  const Icon = tone === "good" ? IconCheck : tone === "warn" || tone === "bad" ? IconAlert : tone === "test" ? IconFlask : IconInfo;
  return (
    <div className={`notice ${tone}`} role={tone === "bad" ? "alert" : undefined}>
      <Icon className="icon" />
      <div>
        {title ? <strong>{title}</strong> : null}
        {children ? <span>{children}</span> : null}
      </div>
    </div>
  );
}

/** Shows ?notice= / ?error= messages set by server actions after a redirect. */
export function Flash({ sp }: { sp: Record<string, string | string[] | undefined> }) {
  const notice = typeof sp.notice === "string" ? sp.notice : null;
  const error = typeof sp.error === "string" ? sp.error : null;
  return (
    <>
      {notice ? <Notice tone="good" title={notice} /> : null}
      {error ? <Notice tone="bad" title={error} /> : null}
    </>
  );
}

export function Kpi({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="kpi">
      <span className="k">{label}</span>
      <span className="v">{value}</span>
      {sub ? <span className="s">{sub}</span> : null}
    </div>
  );
}

export function Empty({ title, children, actions }: { title: string; children?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      {children ? <p>{children}</p> : null}
      {actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

export function Progress({ value, total }: { value: number; total: number }) {
  const w = total > 0 ? Math.min(100, (value / total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${w}%` }} />
    </div>
  );
}

export function FunnelBars({ rows, base }: { rows: { label: string; value: number }[]; base: number }) {
  return (
    <div className="funnel">
      {rows.map((r) => (
        <div className="funnel-row" key={r.label}>
          <span>{r.label}</span>
          <div className="bar">
            <span style={{ width: `${base > 0 ? Math.min(100, (r.value / base) * 100) : 0}%` }} />
          </div>
          <span className="val">
            {fmtNum(r.value)}
            <small>{base > 0 ? `${((r.value / base) * 100).toFixed(1)}%` : ""}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

const STEP_COLORS = ["var(--step1)", "var(--step2)", "var(--step3)", "var(--step4)"];
export const stepColor = (step: number) => STEP_COLORS[(step - 1) % STEP_COLORS.length];

/** Stacked bars of emails per day by sequence step. */
export function DailyChart({ series, steps }: { series: { date: string; byStep: Record<number, number>; total: number }[]; steps: number }) {
  const W = 720, H = 200, pl = 34, pr = 8, pt = 10, pb = 26;
  const max = Math.max(4, ...series.map((s) => s.total));
  const nice = Math.ceil(max / 4) * 4;
  const bw = (W - pl - pr) / series.length;
  const y = (v: number) => pt + (H - pt - pb) * (1 - v / nice);
  const ticks = [0, nice / 4, nice / 2, (3 * nice) / 4, nice];
  return (
    <div className="stack">
      <div className="chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Emails sent per day">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth="1" />
              <text x={pl - 6} y={y(t) + 4} textAnchor="end">{t}</text>
            </g>
          ))}
          {series.map((s, i) => {
            let acc = 0;
            const x = pl + i * bw + bw * 0.18;
            const w = bw * 0.64;
            return (
              <g key={s.date}>
                {Array.from({ length: steps }, (_, k) => k + 1).map((step) => {
                  const v = s.byStep[step] ?? 0;
                  if (!v) return null;
                  const top = y(acc + v);
                  const h = y(acc) - top;
                  acc += v;
                  return <rect key={step} x={x} y={top} width={w} height={Math.max(1, h)} fill={stepColor(step)} rx="1.5"><title>{`${s.date} · Email ${step}: ${v}`}</title></rect>;
                })}
                {i % Math.ceil(series.length / 7) === 0 ? (
                  <text x={x + w / 2} y={H - 8} textAnchor="middle">{s.date.slice(8)}/{s.date.slice(5, 7)}</text>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="legend">
        {Array.from({ length: steps }, (_, k) => (
          <span key={k}><i style={{ background: stepColor(k + 1) }} />Email {k + 1}</span>
        ))}
      </div>
    </div>
  );
}
