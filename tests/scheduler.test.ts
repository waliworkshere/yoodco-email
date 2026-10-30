import { describe, expect, it } from "vitest";
import type { Mailbox } from "@prisma/client";
import { mailboxAvailable } from "@/lib/engine/scheduler";

const now = new Date("2026-11-02T06:00:00Z");
const box = (over: Partial<Mailbox> = {}) =>
  ({ id: "m1", status: "ACTIVE", nextSendAt: null, hourlyLimit: 8, dailyLimit: 30, warmupEnabled: false, warmupStartedAt: null, warmupStart: 5, warmupIncrement: 3, ...over }) as Mailbox;
const usage = (hour: number, day: number) => ({ hour: new Map([["m1", hour]]), day: new Map([["m1", day]]) });
const live = { ignoreLimits: false, ignoreStatus: false };

describe("mailbox availability", () => {
  it("is available when active, rested and under limits", () => {
    expect(mailboxAvailable(box(), usage(0, 0), now, live)).toBe(true);
  });
  it("respects pause, rest time, hourly and daily limits", () => {
    expect(mailboxAvailable(box({ status: "PAUSED" }), usage(0, 0), now, live)).toBe(false);
    expect(mailboxAvailable(box({ nextSendAt: new Date(now.getTime() + 60_000) }), usage(0, 0), now, live)).toBe(false);
    expect(mailboxAvailable(box(), usage(8, 8), now, live)).toBe(false);
    expect(mailboxAvailable(box(), usage(1, 30), now, live)).toBe(false);
  });
  it("applies the warm-up limit", () => {
    const warm = box({ warmupEnabled: true, warmupStartedAt: now });
    expect(mailboxAvailable(warm, usage(0, 4), now, live)).toBe(true);
    expect(mailboxAvailable(warm, usage(0, 5), now, live)).toBe(false);
  });
  it("in fast-forward test mode ignores limits, and ignores status when nothing is really delivered", () => {
    expect(mailboxAvailable(box(), usage(99, 99), now, { ignoreLimits: true, ignoreStatus: false })).toBe(true);
    expect(mailboxAvailable(box({ status: "ERROR" }), usage(0, 0), now, { ignoreLimits: false, ignoreStatus: true })).toBe(true);
  });
});
