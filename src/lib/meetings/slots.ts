import { zonedDate, zonedToUtc } from "./time";

/**
 * Bookable times for the built-in booking page: the campaign's meeting days and hours,
 * in its time zone, at least `noticeHours` ahead and at most `horizonDays` out,
 * leaving out anything that overlaps a meeting already booked with the same host.
 */
export interface Availability {
  timezone: string;
  days: number[]; // 0 = Sunday … 6 = Saturday
  startMinute: number;
  endMinute: number;
  durationMin: number;
  noticeHours: number;
  horizonDays: number;
}

export interface Busy {
  start: Date;
  end: Date;
}

const STEP_MIN = 30;

export function availableSlots(a: Availability, busy: Busy[], now = new Date()): Date[] {
  const earliest = now.getTime() + a.noticeHours * 3_600_000;
  const out: Date[] = [];
  const duration = Math.max(10, a.durationMin) * 60_000;
  for (let d = 0; d <= a.horizonDays; d++) {
    const { year, month, day, weekday } = zonedDate(new Date(now.getTime() + d * 86_400_000), a.timezone);
    if (!a.days.includes(weekday)) continue;
    for (let m = a.startMinute; m + a.durationMin <= a.endMinute; m += STEP_MIN) {
      const start = zonedToUtc(year, month, day, m, a.timezone);
      if (start.getTime() < earliest) continue;
      const end = start.getTime() + duration;
      if (busy.some((b) => start.getTime() < b.end.getTime() && end > b.start.getTime())) continue;
      if (!out.some((s) => s.getTime() === start.getTime())) out.push(start);
    }
  }
  return out.sort((x, y) => x.getTime() - y.getTime());
}

export function isSlotAvailable(slot: Date, a: Availability, busy: Busy[], now = new Date()): boolean {
  return availableSlots(a, busy, now).some((s) => s.getTime() === slot.getTime());
}
