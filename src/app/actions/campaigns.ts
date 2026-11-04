"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseContactSheet } from "@/lib/import";
import { composeStep, messageIdFor } from "@/lib/engine/send";
import { applyBounce, applyReply } from "@/lib/engine/outcomes";
import { deliver } from "@/lib/mail/transport";
import { randomToken } from "@/lib/crypto";
import { availabilityFor, busyFor, hostFor, recordMeeting, sendInvite } from "@/lib/meetings/record";
import { availableSlots } from "@/lib/meetings/slots";
import { isValidTimezone } from "@/lib/meetings/time";

const go = (path: string, params: Record<string, string>): never => {
  const [base, query] = path.split("?");
  const merged = new URLSearchParams(query);
  merged.delete("notice");
  merged.delete("error");
  for (const [k, v] of Object.entries(params)) merged.set(k, v);
  return redirect(`${base}?${merged}`);
};
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const int = (f: FormData, k: string, def: number, min = 0, max = 100_000) => {
  const n = Number(f.get(k));
  return Number.isFinite(n) && f.get(k) !== "" && f.get(k) !== null ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const bool = (f: FormData, k: string) => f.get(k) === "on" || f.get(k) === "true";
const hhmmToMinutes = (v: string, def: number) => {
  const m = v.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Math.min(1440, Number(m[1]) * 60 + Number(m[2])) : def;
};

// ─── Create from a contact sheet ─────────────────────────────────────────

export async function createCampaign(form: FormData) {
  const user = await requireUser();
  const name = str(form, "name");
  const file = form.get("file");
  if (!name) go("/campaigns/new", { error: "Give the campaign a name." });
  if (!(file instanceof File) || file.size === 0) go("/campaigns/new", { error: "Choose a contact sheet (.xlsx or .csv)." });
  const upload = file as File;

  let parsed;
  try {
    parsed = await parseContactSheet(Buffer.from(await upload.arrayBuffer()), upload.name);
  } catch (e) {
    return go("/campaigns/new", { error: (e as Error).message });
  }
  if (!parsed.rows.length) go("/campaigns/new", { error: "No valid contacts found in the file." });

  const mailboxes = await db.mailbox.findMany({ orderBy: { email: "asc" } });
  const byEmail = new Map(mailboxes.map((m) => [m.email.toLowerCase(), m]));
  const assignMissing = str(form, "assignMissing") === "roundrobin";
  const pool = mailboxes.filter((m) => m.status === "ACTIVE");

  const stepCount = Math.max(1, parsed.stepCount);
  const delays = [0, int(form, "delay2", 3, 0, 60), int(form, "delay3", 4, 0, 60)];

  // Contacts are shared across campaigns (global suppression lives on them)
  await db.contact.createMany({
    data: parsed.rows.map((r) => ({ email: r.email, firstName: r.firstName || null, lastName: r.lastName || null, company: r.company || null })),
    skipDuplicates: true,
  });
  const contacts = await db.contact.findMany({ where: { email: { in: parsed.rows.map((r) => r.email) } } });
  const contactByEmail = new Map(contacts.map((c) => [c.email, c]));

  let rr = 0;
  let unassigned = 0;
  const senderReport = new Map<string, { email: string; contacts: number; connected: boolean }>();
  const enrollments: Prisma.CampaignContactCreateManyInput[] = [];

  const campaign = await db.campaign.create({
    data: {
      name,
      mode: "TEST",
      createdById: user.id,
      timezone: str(form, "timezone") || "Asia/Dubai",
      hourlyLimit: int(form, "hourlyLimit", 20, 1, 500),
      steps: {
        create: Array.from({ length: stepCount }, (_, i) => ({ order: i + 1, delayDays: i === 0 ? 0 : (delays[i] ?? 3) })),
      },
    },
  });

  for (const r of parsed.rows) {
    const contact = contactByEmail.get(r.email)!;
    let mailbox = r.senderEmail ? byEmail.get(r.senderEmail) : undefined;
    if (r.senderEmail) {
      const rep = senderReport.get(r.senderEmail) ?? { email: r.senderEmail, contacts: 0, connected: Boolean(mailbox) };
      rep.contacts++;
      senderReport.set(r.senderEmail, rep);
    }
    if (!mailbox && assignMissing && pool.length) mailbox = pool[rr++ % pool.length];
    if (!mailbox) unassigned++;
    enrollments.push({
      campaignId: campaign.id,
      contactId: contact.id,
      mailboxId: mailbox?.id ?? null,
      senderEmail: r.senderEmail || null,
      content: r.steps as unknown as Prisma.InputJsonValue,
      variables: r.variables,
    });
  }
  await db.campaignContact.createMany({ data: enrollments, skipDuplicates: true });

  const suppressed = contacts.filter((c) => c.unsubscribedAt || c.bouncedAt).length;
  await db.campaign.update({
    where: { id: campaign.id },
    data: {
      importReport: {
        fileName: upload.name,
        imported: parsed.rows.length,
        stepCount: parsed.stepCount,
        invalid: parsed.invalid.slice(0, 200),
        invalidCount: parsed.invalid.length,
        duplicates: parsed.duplicates.length,
        suppressed,
        unassigned,
        senders: [...senderReport.values()].sort((a, b) => b.contacts - a.contacts),
        columns: parsed.columns,
      },
    },
  });
  redirect(`/campaigns/${campaign.id}?notice=${encodeURIComponent(`Imported ${parsed.rows.length} contacts. The campaign is in test mode.`)}`);
}

// ─── Lifecycle ───────────────────────────────────────────────────────────

async function readiness(campaignId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, include: { steps: true } });
  const problems: string[] = [];
  const enrolled = await db.campaignContact.count({ where: { campaignId } });
  const unassigned = await db.campaignContact.count({ where: { campaignId, mailboxId: null, status: { in: ["QUEUED", "ACTIVE"] } } });
  if (!enrolled) problems.push("The campaign has no contacts.");
  if (unassigned === enrolled && enrolled > 0) problems.push("No contact has a connected sending mailbox. Connect the mailboxes from the sheet, or reassign contacts.");
  if (c.mode === "LIVE") {
    const boxes = await db.mailbox.findMany({ where: { campaignContacts: { some: { campaignId } } } });
    const sandbox = boxes.filter((b) => b.provider === "SANDBOX");
    if (sandbox.length) problems.push(`Sandbox mailboxes cannot send live email: ${sandbox.map((b) => b.email).join(", ")}. Reassign those contacts or connect the real mailbox.`);
    if (!process.env.APP_URL?.startsWith("https://")) problems.push("APP_URL must be a public https:// address for open/click tracking and unsubscribe links to work for recipients.");
  }
  return { c, problems, unassigned };
}

export async function startCampaign(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  const { c, problems } = await readiness(id);
  const path = `/campaigns/${id}`;
  if (problems.length) go(path, { error: problems.join(" ") });
  const now = new Date();
  await db.campaignContact.updateMany({ where: { campaignId: id, status: "QUEUED", nextStepAt: null }, data: { nextStepAt: now } });
  await db.campaign.update({ where: { id }, data: { status: "RUNNING", startedAt: c.startedAt ?? now, nextSendAt: null, completedAt: null } });
  revalidatePath(path);
  go(path, { notice: c.mode === "TEST" ? "Test run started. Emails are captured, nobody receives them." : "Sending started. The first email goes out within a few minutes, during the sending window." });
}

export async function pauseCampaign(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  await db.campaign.update({ where: { id }, data: { status: "PAUSED" } });
  go(`/campaigns/${id}`, { notice: "Paused. Nothing more will be sent until you resume." });
}

async function resetRun(id: string) {
  await db.meeting.deleteMany({ where: { campaignId: id } });
  await db.event.deleteMany({ where: { campaignId: id } });
  await db.message.deleteMany({ where: { campaignId: id } });
  await db.campaignContact.updateMany({
    where: { campaignId: id },
    data: { status: "QUEUED", currentStep: 0, nextStepAt: null, attempts: 0, lastError: null, threadRootMessageId: null, lastMessageId: null, repliedAt: null, stoppedReason: null,
      replyText: null, replyMessageId: null, replyIntent: null, replyIntentBy: null, bookingReplyDueAt: null, bookingReplySentAt: null, meetingBookedAt: null },
  });
}

export async function resetTestRun(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  const c = await db.campaign.findUniqueOrThrow({ where: { id } });
  if (c.mode !== "TEST") go(`/campaigns/${id}`, { error: "Only test runs can be reset." });
  await resetRun(id);
  await db.campaign.update({ where: { id }, data: { status: "DRAFT", startedAt: null, completedAt: null, nextSendAt: null } });
  go(`/campaigns/${id}`, { notice: "Test run cleared. Every contact is back at the start." });
}

export async function goLive(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  if (str(form, "confirm") !== "LIVE") go(`/campaigns/${id}`, { tab: "launch", error: 'Type LIVE to confirm.' });
  await resetRun(id);
  await db.campaign.update({
    where: { id },
    data: { mode: "LIVE", status: "DRAFT", startedAt: null, completedAt: null, nextSendAt: null, testRedirectTo: null },
  });
  go(`/campaigns/${id}`, { notice: "Switched to live. Test results were cleared. Press Start sending when ready." });
}

export async function backToTest(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  const sent = await db.message.count({ where: { campaignId: id, mode: "LIVE" } });
  if (sent > 0) go(`/campaigns/${id}`, { error: "This campaign has already sent live emails, so it cannot go back to test mode. Duplicate it instead." });
  await db.campaign.update({ where: { id }, data: { mode: "TEST", status: "DRAFT" } });
  go(`/campaigns/${id}`, { notice: "Back in test mode." });
}

export async function deleteCampaign(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  await db.campaign.delete({ where: { id } });
  go("/campaigns", { notice: "Campaign deleted." });
}

export async function duplicateCampaign(form: FormData) {
  const user = await requireUser();
  const id = str(form, "id");
  const src = await db.campaign.findUniqueOrThrow({ where: { id }, include: { steps: true } });
  const { id: _i, createdAt: _c, updatedAt: _u, startedAt: _s, completedAt: _d, nextSendAt: _n, importReport, steps, ...rest } = src;
  const copy = await db.campaign.create({
    data: {
      ...rest,
      importReport: importReport ?? undefined,
      name: `${src.name} (copy)`,
      status: "DRAFT",
      mode: "TEST",
      createdById: user.id,
      steps: { create: steps.map((s) => ({ order: s.order, delayDays: s.delayDays, subject: s.subject, body: s.body })) },
    },
  });
  const enrollments = await db.campaignContact.findMany({ where: { campaignId: id } });
  await db.campaignContact.createMany({
    data: enrollments.map((e) => ({
      campaignId: copy.id,
      contactId: e.contactId,
      mailboxId: e.mailboxId,
      senderEmail: e.senderEmail,
      content: e.content ?? undefined,
      variables: e.variables ?? undefined,
    })),
  });
  go(`/campaigns/${copy.id}`, { notice: "Duplicated into a new test-mode campaign." });
}

// ─── Settings ────────────────────────────────────────────────────────────

export async function updateCampaignSettings(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  const days = form.getAll("sendDays").map(Number).filter((n) => n >= 0 && n <= 6);
  const minGap = int(form, "minGapSeconds", 90, 10, 3600);
  const maxGap = Math.max(minGap, int(form, "maxGapSeconds", 270, 10, 7200));
  const testRedirectTo = str(form, "testRedirectTo").toLowerCase();
  if (testRedirectTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(testRedirectTo)) go(`/campaigns/${id}`, { tab: "settings", error: "The test inbox address is not a valid email." });
  const tz = str(form, "timezone") || "Asia/Dubai";
  if (!isValidTimezone(tz)) go(`/campaigns/${id}`, { tab: "settings", error: `Unknown time zone "${tz}". Use a name like America/Chicago or Asia/Dubai.` });

  await db.campaign.update({
    where: { id },
    data: {
      name: str(form, "name") || undefined,
      timezone: tz,
      sendDays: days,
      windowStart: hhmmToMinutes(str(form, "windowStart"), 540),
      windowEnd: hhmmToMinutes(str(form, "windowEnd"), 1020),
      hourlyLimit: int(form, "hourlyLimit", 20, 1, 500),
      minGapSeconds: minGap,
      maxGapSeconds: maxGap,
      trackOpens: bool(form, "trackOpens"),
      trackClicks: bool(form, "trackClicks"),
      stopOnReply: bool(form, "stopOnReply"),
      stopOnDomainReply: bool(form, "stopOnDomainReply"),
      threadFollowUps: bool(form, "threadFollowUps"),
      unsubscribeFooter: bool(form, "unsubscribeFooter"),
      unsubscribeText: str(form, "unsubscribeText") || undefined,
      testFastForward: bool(form, "testFastForward"),
      testRedirectTo: testRedirectTo || null,
    },
  });
  if (form.has("bookingMode")) {
    const mode = str(form, "bookingMode");
    const bookingUrl = str(form, "bookingUrl");
    const host = str(form, "meetingHostEmail").toLowerCase();
    const replyText = String(form.get("bookingReplyText") ?? "").trim();
    if (mode === "EXTERNAL" && !/^https:\/\//.test(bookingUrl)) go(`/campaigns/${id}`, { tab: "settings", error: "Paste your booking link (it starts with https://), or choose the built-in booking page." });
    if (host && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(host)) go(`/campaigns/${id}`, { tab: "settings", error: "The meeting host is not a valid email address." });
    if (replyText && !/\{\{\s*booking(link|url)\s*\}\}/i.test(replyText)) go(`/campaigns/${id}`, { tab: "settings", error: "The booking reply must contain {{bookingLink}}." });
    const minD = int(form, "bookingReplyMinDelay", 4, 0, 240);
    await db.campaign.update({
      where: { id },
      data: {
        bookingMode: mode === "EXTERNAL" ? "EXTERNAL" : mode === "OFF" ? "OFF" : "BUILT_IN",
        bookingUrl: bookingUrl || null,
        meetingHostEmail: host || null,
        meetingTitle: str(form, "meetingTitle") || undefined,
        meetingDurationMin: int(form, "meetingDurationMin", 30, 10, 240),
        meetingLocation: str(form, "meetingLocation") || null,
        meetingDays: form.getAll("meetingDays").map(Number).filter((n) => n >= 0 && n <= 6),
        meetingStart: hhmmToMinutes(str(form, "meetingStart"), 600),
        meetingEnd: hhmmToMinutes(str(form, "meetingEnd"), 1020),
        meetingNoticeHours: int(form, "meetingNoticeHours", 12, 0, 336),
        meetingHorizonDays: int(form, "meetingHorizonDays", 14, 1, 60),
        autoBookingReply: bool(form, "autoBookingReply"),
        bookingReplyText: replyText || undefined,
        bookingReplyMinDelay: minD,
        bookingReplyMaxDelay: Math.max(minD, int(form, "bookingReplyMaxDelay", 12, 0, 480)),
      },
    });
  }

  const steps = await db.campaignStep.findMany({ where: { campaignId: id } });
  for (const s of steps) {
    await db.campaignStep.update({
      where: { id: s.id },
      data: {
        delayDays: s.order === 1 ? 0 : int(form, `delay_${s.order}`, s.delayDays, 0, 90),
        subject: String(form.get(`subject_${s.order}`) ?? s.subject),
        body: String(form.get(`body_${s.order}`) ?? s.body),
      },
    });
  }
  go(`/campaigns/${id}`, { tab: "settings", notice: "Settings saved." });
}

export async function reassignUnassigned(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  const pool = await db.mailbox.findMany({ where: { status: "ACTIVE" }, orderBy: { email: "asc" } });
  if (!pool.length) go(`/campaigns/${id}`, { error: "Connect at least one active mailbox first." });
  const waiting = await db.campaignContact.findMany({ where: { campaignId: id, mailboxId: null }, select: { id: true } });
  for (let i = 0; i < waiting.length; i++) {
    await db.campaignContact.update({ where: { id: waiting[i].id }, data: { mailboxId: pool[i % pool.length].id } });
  }
  go(`/campaigns/${id}`, { notice: `Assigned ${waiting.length} contacts across ${pool.length} mailboxes.` });
}

// ─── Testing tools ───────────────────────────────────────────────────────

/** Sends every step of the sequence for one contact to an address you choose (real delivery, no tracking). */
export async function sendTestToMe(form: FormData) {
  await requireUser();
  const id = str(form, "id");
  const to = str(form, "to").toLowerCase();
  const path = `/campaigns/${id}`;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) go(path, { tab: "launch", error: "Enter a valid email address to receive the test." });

  const ccId = str(form, "contactId");
  const cc = await db.campaignContact.findFirst({
    where: { campaignId: id, mailboxId: { not: null }, ...(ccId ? { id: ccId } : {}) },
    include: { contact: true, mailbox: true, campaign: { include: { steps: { orderBy: { order: "asc" } } } } },
    orderBy: { createdAt: "asc" },
  });
  if (!cc || !cc.mailbox) return go(path, { tab: "launch", error: "No contact with a connected mailbox to build the test from." });

  const sent: number[] = [];
  try {
    for (const s of cc.campaign.steps) {
      const token = randomToken();
      const composed = await composeStep({ ...cc, campaign: { ...cc.campaign, trackOpens: false, trackClicks: false } }, s.order, token);
      if (!composed) continue;
      await deliver(
        cc.mailbox,
        {
          from: { name: cc.mailbox.displayName, address: cc.mailbox.email },
          to,
          subject: `[Test ${s.order}/${cc.campaign.steps.length} → ${cc.contact.email}] ${composed.subject}`,
          text: composed.text,
          html: composed.html,
          messageId: messageIdFor(token, cc.mailbox.email),
        },
        "mailbox",
      );
      sent.push(s.order);
    }
  } catch (e) {
    return go(path, { tab: "launch", error: `Sending through ${cc.mailbox.email} failed: ${(e as Error).message}` });
  }
  const where = cc.mailbox.provider === "SANDBOX" ? "the sandbox inbox" : to;
  go(path, { tab: "launch", notice: `Sent ${sent.length} test emails from ${cc.mailbox.email} to ${where}, written for ${cc.contact.email}.` });
}

async function latestMessage(ccId: string) {
  return db.message.findFirst({ where: { campaignContactId: ccId, status: "SENT" }, orderBy: { sentAt: "desc" } });
}

export async function simulate(form: FormData) {
  await requireUser();
  const ccId = str(form, "ccId");
  const what = str(form, "what");
  const back = str(form, "back") || "/campaigns";
  const cc = await db.campaignContact.findUniqueOrThrow({ where: { id: ccId }, include: { campaign: true } });
  if (cc.campaign.mode !== "TEST") go(back, { error: "Simulations are only available in test mode." });
  const msg = await latestMessage(ccId);
  if (!msg) go(back, { error: "Nothing has been sent to this contact yet." });
  const m = msg!;
  const now = new Date();
  const replies: Record<string, string> = {
    reply: "Sounds interesting, happy to have a quick call. What does your calendar look like next week?",
    reply_question: "How is this different from what we use today?",
    reply_not: "Thanks, but we're not interested at the moment.",
    reply_unsub: "Please remove me from your list.",
  };
  if (replies[what]) await applyReply(m, { detail: `Simulated reply: "${replies[what]}"`, text: replies[what], at: now });
  if (what === "meeting") {
    const cc2 = await db.campaignContact.findUniqueOrThrow({ where: { id: ccId }, include: { contact: true, campaign: true, mailbox: true } });
    const slot = availableSlots(availabilityFor(cc2.campaign), await busyFor(hostFor(cc2.campaign, cc2.mailbox)), now)[0] ?? new Date(now.getTime() + 2 * 86_400_000);
    const { meeting } = await recordMeeting({ source: "BOOKING_PAGE", email: cc2.contact.email, startsAt: slot, location: cc2.campaign.meetingLocation, enrollment: cc2 });
    await sendInvite(meeting, cc2).catch(() => undefined);
  }
  if (what === "bounce") await applyBounce(m, "Simulated bounce: 550 5.1.1 mailbox does not exist");
  if (what === "open" || what === "click") {
    const links = (m.links as string[]) ?? [];
    await db.event.create({
      data: { type: what === "open" ? "OPEN" : "CLICK", campaignId: m.campaignId, campaignContactId: m.campaignContactId, messageId: m.id, url: what === "click" ? links[0] ?? null : null, userAgent: "Simulated in test mode" },
    });
    await db.message.update({
      where: { id: m.id },
      data:
        what === "open"
          ? { openCount: { increment: 1 }, firstOpenedAt: m.firstOpenedAt ?? now }
          : { clickCount: { increment: 1 }, firstClickedAt: m.firstClickedAt ?? now, firstOpenedAt: m.firstOpenedAt ?? now },
    });
  }
  const labels: Record<string, string> = {
    reply: "Interested reply",
    reply_question: "Question",
    reply_not: "Not-interested reply",
    reply_unsub: "Removal request",
    meeting: "Meeting booking",
    bounce: "Bounce",
    open: "Open",
    click: "Click",
  };
  go(back, { notice: `${labels[what] ?? "Event"} recorded for this contact.` });
}

export async function stopContact(form: FormData) {
  await requireUser();
  const ccId = str(form, "ccId");
  const back = str(form, "back") || "/campaigns";
  const cc = await db.campaignContact.update({ where: { id: ccId }, data: { status: "STOPPED", stoppedReason: "Stopped by a teammate", nextStepAt: null } });
  await db.event.create({ data: { type: "STOPPED", campaignId: cc.campaignId, campaignContactId: cc.id, detail: "Stopped by a teammate" } });
  go(back, { notice: "Sequence stopped for this contact." });
}
