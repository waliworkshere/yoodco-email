import { describe, expect, it } from "vitest";
import { looksAutomatic, looksLikeBounce, parseIds } from "@/lib/engine/inbox";
import { classifySendError, MailboxAuthError } from "@/lib/mail/transport";

describe("inbound classification", () => {
  it("extracts message ids", () => {
    expect(parseIds("<a@x.com> <b@y.com>")).toEqual(["<a@x.com>", "<b@y.com>"]);
    expect(parseIds(["<a@x.com>"])).toEqual(["<a@x.com>"]);
    expect(parseIds(undefined)).toEqual([]);
  });
  it("recognises bounces", () => {
    expect(looksLikeBounce("mailer-daemon@googlemail.com", "Delivery Status Notification (Failure)", "")).toBe(true);
    expect(looksLikeBounce("postmaster@outlook.com", "Undeliverable: Hello", "")).toBe(true);
    expect(looksLikeBounce("ceo@acme.com", "Re: Hello", "text/plain")).toBe(false);
  });
  it("recognises out-of-office replies", () => {
    expect(looksAutomatic({ "auto-submitted": "auto-replied" }, "Re: Hi")).toBe(true);
    expect(looksAutomatic({}, "Automatic reply: Hi")).toBe(true);
    expect(looksAutomatic({}, "Out of Office: back Monday")).toBe(true);
    expect(looksAutomatic({ "auto-submitted": "no" }, "Re: Hi")).toBe(false);
  });
});

describe("send error classification", () => {
  it("separates mailbox, recipient and temporary problems", () => {
    expect(classifySendError(new MailboxAuthError("x"))).toBe("auth");
    expect(classifySendError({ code: "EAUTH", message: "Invalid login" })).toBe("auth");
    expect(classifySendError({ command: "RCPT TO", responseCode: 550, message: "No such user" })).toBe("recipient");
    expect(classifySendError({ code: "ETIMEDOUT", message: "timeout" })).toBe("transient");
    expect(classifySendError({ responseCode: 421, message: "try later" })).toBe("transient");
  });
});
