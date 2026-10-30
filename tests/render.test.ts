import { describe, expect, it } from "vitest";
import { fillTemplate, missingPlaceholders, renderEmail } from "@/lib/render";

const opts = { appUrl: "https://mail.yood.ai", token: "tok123", trackOpens: true, trackClicks: true };

describe("templates", () => {
  it("fills placeholders case-insensitively, with fallbacks", () => {
    expect(fillTemplate("Hi {{FirstName}}, {{ company | your team }}!", { firstName: "Risto" })).toBe("Hi Risto, your team!");
  });
  it("lists placeholders that have no value", () => {
    expect(missingPlaceholders("{{firstName}} {{industry}} {{x|y}}", { firstName: "A" })).toEqual(["industry"]);
  });
});

describe("renderEmail", () => {
  const body = "Hi {{firstName}},\n\nBook here: https://calendar.app.google/abc.\nThanks\n\nSee https://yood.ai and https://calendar.app.google/abc";
  const r = renderEmail("Hello {{firstName}}", body, { firstName: "Ava" }, { ...opts, unsubscribeLine: "Opt out: {{unsubscribeUrl}}", signature: "— {{senderName}}" });

  it("keeps the plain-text version untracked and readable", () => {
    expect(r.subject).toBe("Hello Ava");
    expect(r.text).toContain("https://calendar.app.google/abc.");
    expect(r.text).toContain("Opt out: https://mail.yood.ai/u/tok123");
    expect(r.text).not.toContain("/t/c/");
  });
  it("rewrites body links through the click tracker, de-duplicated, without trailing punctuation", () => {
    expect(r.links).toEqual(["https://calendar.app.google/abc", "https://yood.ai"]);
    expect(r.html).toContain('href="https://mail.yood.ai/t/c/tok123/0"');
    expect(r.html).toContain('href="https://mail.yood.ai/t/c/tok123/1"');
    expect(r.html).toContain("abc</a>.");
  });
  it("adds the open pixel and leaves the unsubscribe link untracked", () => {
    expect(r.html).toContain("/t/o/tok123.gif");
    expect(r.html).toContain('href="https://mail.yood.ai/u/tok123"');
  });
  it("escapes HTML in the copy", () => {
    const x = renderEmail("s", "<script>alert(1)</script> & co", {}, opts);
    expect(x.html).toContain("&lt;script&gt;");
    expect(x.html).not.toContain("<script>");
  });
  it("omits tracking when disabled", () => {
    const x = renderEmail("s", "https://yood.ai", {}, { ...opts, trackOpens: false, trackClicks: false });
    expect(x.html).not.toContain("/t/o/");
    expect(x.html).toContain('href="https://yood.ai"');
    expect(x.links).toEqual(["https://yood.ai"]);
  });
});
