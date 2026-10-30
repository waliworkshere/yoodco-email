import { describe, expect, it } from "vitest";
import { effectiveDailyLimit, forecastDays, isInWindow, jitterMs, localParts, nextWindowOpen, stepDelayMs } from "@/lib/schedule";

const dubai = { timezone: "Asia/Dubai", sendDays: [1, 2, 3, 4, 5], windowStart: 9 * 60, windowEnd: 17 * 60 };

describe("sending window", () => {
  it("reads local time in the campaign time zone", () => {
    // 2026-11-02 05:30 UTC = Monday 09:30 in Dubai (UTC+4)
    const p = localParts(new Date("2026-11-02T05:30:00Z"), "Asia/Dubai");
    expect(p.weekday).toBe(1);
    expect(p.minute).toBe(9 * 60 + 30);
  });
  it("is open on a weekday inside hours and closed outside", () => {
    expect(isInWindow(new Date("2026-11-02T05:30:00Z"), dubai)).toBe(true); // Mon 09:30
    expect(isInWindow(new Date("2026-11-02T04:59:00Z"), dubai)).toBe(false); // Mon 08:59
    expect(isInWindow(new Date("2026-11-02T13:00:00Z"), dubai)).toBe(false); // Mon 17:00 (end is exclusive)
    expect(isInWindow(new Date("2026-11-01T06:00:00Z"), dubai)).toBe(false); // Sunday
  });
  it("finds the next opening after a weekend", () => {
    // Saturday 31 Oct 2026, 12:00 Dubai → Monday 2 Nov 09:00 Dubai = 05:00 UTC
    const next = nextWindowOpen(new Date("2026-10-31T08:00:00Z"), dubai);
    expect(next?.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
  it("returns null when the window can never open", () => {
    expect(nextWindowOpen(new Date(), { ...dubai, sendDays: [] })).toBeNull();
  });
});

describe("pacing", () => {
  it("keeps jitter within bounds", () => {
    expect(jitterMs(90, 270, () => 0)).toBe(90_000);
    expect(jitterMs(90, 270, () => 1)).toBe(270_000);
    expect(jitterMs(270, 90, () => 0.5)).toBe(180_000);
  });
  it("ramps warm-up limits up to the daily limit", () => {
    const m = { dailyLimit: 30, warmupEnabled: true, warmupStartedAt: new Date("2026-11-01T00:00:00Z"), warmupStart: 5, warmupIncrement: 3 };
    expect(effectiveDailyLimit(m, new Date("2026-11-01T10:00:00Z"))).toBe(5);
    expect(effectiveDailyLimit(m, new Date("2026-11-04T10:00:00Z"))).toBe(14);
    expect(effectiveDailyLimit(m, new Date("2026-12-01T10:00:00Z"))).toBe(30);
    expect(effectiveDailyLimit({ ...m, warmupEnabled: false }, new Date())).toBe(30);
  });
  it("compresses days to minutes in test fast-forward", () => {
    expect(stepDelayMs(3, false)).toBe(3 * 86_400_000);
    expect(stepDelayMs(3, true)).toBe(3 * 60_000);
  });
  it("forecasts sending days", () => {
    // 1,620 sends at 20/hour over 8 hours = 160/day → 11 days
    expect(forecastDays(1620, 20, 480, 7 * 30)).toBe(11);
  });
});
