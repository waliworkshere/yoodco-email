"use client";
import { useEffect, useMemo, useState } from "react";
import { bookSlot } from "@/app/actions/booking";

/** Free times grouped by day, shown in the visitor's own time zone. */
export function SlotPicker({ token, slots, duration, rescheduling }: { token: string; slots: string[]; duration: number; rescheduling: boolean }) {
  // Times depend on the visitor's time zone, so they are drawn in the browser only
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const tz = useMemo(() => (ready ? Intl.DateTimeFormat().resolvedOptions().timeZone : "UTC"), [ready]);
  const days = useMemo(() => {
    const byDay = new Map<string, { label: string; times: string[] }>();
    const dayFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" });
    for (const iso of slots) {
      const d = new Date(iso);
      const key = d.toLocaleDateString("en-CA");
      if (!byDay.has(key)) byDay.set(key, { label: dayFmt.format(d), times: [] });
      byDay.get(key)!.times.push(iso);
    }
    return [...byDay.values()];
  }, [slots, ready]);
  const [day, setDay] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
  const longFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" });

  if (!ready) return <p className="bk-muted">Loading free times…</p>;
  if (!days.length) return <p className="bk-muted">There are no free times in the next two weeks. Just reply to the email and we&apos;ll find one.</p>;
  const current = days[Math.min(day, days.length - 1)];

  return (
    <div className="bk-picker">
      <div className="bk-days" role="tablist" aria-label="Day">
        {days.map((d, i) => (
          <button key={d.label} type="button" role="tab" aria-selected={i === day} className="bk-day" onClick={() => { setDay(i); setPicked(null); }}>
            <span>{d.label.split(",")[0]}</span>
            <b>{d.label.split(",").slice(1).join(",").trim() || d.label}</b>
          </button>
        ))}
      </div>
      <div className="bk-times">
        {current.times.map((iso) => (
          <button key={iso} type="button" className="bk-time" aria-pressed={picked === iso} onClick={() => setPicked(iso)}>
            {timeFmt.format(new Date(iso))}
          </button>
        ))}
      </div>
      <p className="bk-tz">Times shown in your time zone ({tz.replace(/_/g, " ")}) · {duration} minutes</p>
      {picked ? (
        <form action={bookSlot} className="bk-confirm" onSubmit={() => setBusy(true)}>
          <input type="hidden" name="token" value={token} />
          <input type="hidden" name="slot" value={picked} />
          <span>{longFmt.format(new Date(picked))}</span>
          <button className="bk-btn" type="submit" disabled={busy}>{busy ? "Booking…" : rescheduling ? "Move to this time" : "Confirm"}</button>
        </form>
      ) : null}
    </div>
  );
}

export function LocalTime({ iso }: { iso: string }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return <>{new Date(iso).toUTCString().slice(0, 22)} UTC</>;
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return <>{fmt.format(new Date(iso))}</>;
}
