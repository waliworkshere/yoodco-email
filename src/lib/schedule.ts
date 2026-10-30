/**
 * Pure scheduling helpers: sending windows, caps and gaps.
 * No database access here, so every rule is unit-tested in tests/schedule.test.ts.
 */

export interface WindowConfig {
  timezone: string;
  sendDays: number[]; // 0 = Sunday … 6 = Saturday
  windowStart: number; // minutes after local midnight
  windowEnd: number;
}

const weekdayIndex: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Local weekday and minute-of-day for an instant in a time zone. */
export function localParts(at: Date, timezone: string): { weekday: number; minute: number; dateKey: string } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    weekday: weekdayIndex[parts.weekday as string] ?? 0,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

export function isInWindow(at: Date, w: WindowConfig): boolean {
  const { weekday, minute } = localParts(at, w.timezone);
  if (!w.sendDays.includes(weekday)) return false;
  return minute >= w.windowStart && minute < w.windowEnd;
}

/** The next instant (≥ from) at which the window is open. Searches up to 8 days ahead in 5-minute steps. */
export function nextWindowOpen(from: Date, w: WindowConfig): Date | null {
  if (w.sendDays.length === 0 || w.windowEnd <= w.windowStart) return null;
  if (isInWindow(from, w)) return from;
  const step = 5 * 60_000;
  // align to the next 5-minute boundary
  let t = Math.ceil(from.getTime() / step) * step;
  const limit = from.getTime() + 8 * 24 * 3600_000;
  for (; t <= limit; t += step) {
    const d = new Date(t);
    if (isInWindow(d, w)) return d;
  }
  return null;
}

/** Random delay in [min, max] seconds, as milliseconds. `rand` is injectable for tests. */
export function jitterMs(minSeconds: number, maxSeconds: number, rand: () => number = Math.random): number {
  const lo = Math.max(0, Math.min(minSeconds, maxSeconds));
  const hi = Math.max(minSeconds, maxSeconds);
  return Math.round((lo + (hi - lo) * rand()) * 1000);
}

/**
 * Daily limit for a mailbox today, taking warm-up into account.
 * Warm-up starts at `warmupStart` and adds `warmupIncrement` per day until it reaches `dailyLimit`.
 */
export function effectiveDailyLimit(
  m: { dailyLimit: number; warmupEnabled: boolean; warmupStartedAt: Date | null; warmupStart: number; warmupIncrement: number },
  now: Date,
): number {
  if (!m.warmupEnabled || !m.warmupStartedAt) return m.dailyLimit;
  const days = Math.max(0, Math.floor((now.getTime() - m.warmupStartedAt.getTime()) / 86_400_000));
  return Math.min(m.dailyLimit, m.warmupStart + days * m.warmupIncrement);
}

/** Delay before a step, in ms. In test fast-forward mode a "day" lasts one minute. */
export function stepDelayMs(delayDays: number, fastForward: boolean): number {
  return delayDays * (fastForward ? 60_000 : 86_400_000);
}

/** Domain part of an email address, lowercased. */
export function emailDomain(email: string): string {
  return email.split("@")[1]?.toLowerCase() ?? "";
}

/** Free-mail domains must never trigger "stop everyone at this company". */
export const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "icloud.com",
  "me.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "gmx.de", "mail.ru", "yandex.ru", "web.de", "qq.com",
]);

/** Plan how long a list will take: used by the "forecast" on the campaign page. */
export function forecastDays(totalSends: number, hourlyLimit: number, windowMinutes: number, mailboxDailyCapacity: number): number {
  const perDayByHour = Math.floor((hourlyLimit * windowMinutes) / 60);
  const perDay = Math.max(1, Math.min(perDayByHour, mailboxDailyCapacity));
  return Math.ceil(totalSends / perDay);
}
