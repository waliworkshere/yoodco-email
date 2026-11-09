"use server";
import { redirect } from "next/navigation";
import { fillTemplate } from "@/lib/render";
import { varsFor } from "@/lib/engine/send";
import { resolveBooking } from "@/lib/meetings/booking";
import { attachVideo, availabilityFor, busyFor, cancelMeeting, hostFor, recordMeeting, sendInvite } from "@/lib/meetings/record";
import { isSlotAvailable } from "@/lib/meetings/slots";

/** Public: a contact picks a time on the booking page. No sign-in; the link itself is the key. */
export async function bookSlot(form: FormData) {
  const token = String(form.get("token") ?? "");
  const slot = new Date(String(form.get("slot") ?? ""));
  const ctx = await resolveBooking(token);
  if (!ctx || Number.isNaN(slot.getTime())) redirect(`/b/${token}?error=missing`);
  const { cc, current } = ctx!;
  if (cc.campaign.bookingMode !== "BUILT_IN") redirect(`/b/${token}`);

  const host = hostFor(cc.campaign, cc.mailbox);
  const busy = await busyFor(host, current?.id);
  if (!isSlotAvailable(slot, availabilityFor(cc.campaign), busy)) redirect(`/b/${token}?error=taken`);

  if (current) {
    const canceled = await cancelMeeting(current, "Moved to another time by the contact");
    await sendInvite(canceled, cc, "CANCEL").catch(() => undefined);
  }
  const title = fillTemplate(cc.campaign.meetingTitle, varsFor(cc.contact, cc.mailbox, cc.variables)).trim();
  const { meeting } = await recordMeeting({
    source: "BOOKING_PAGE",
    email: cc.contact.email,
    title: title || "Intro call",
    startsAt: slot,
    hostEmail: host,
    location: cc.campaign.meetingVideo === "ZOOM" ? null : cc.campaign.meetingLocation,
    enrollment: cc,
  });
  const withVideo = await attachVideo(meeting, cc);
  let invite = "sent";
  try {
    await sendInvite(withVideo, cc);
  } catch {
    invite = "failed";
  }
  redirect(`/b/${token}?booked=1${invite === "failed" ? "&invite=failed" : ""}`);
}

export async function cancelBooking(form: FormData) {
  const token = String(form.get("token") ?? "");
  const ctx = await resolveBooking(token);
  if (!ctx?.current) redirect(`/b/${token}`);
  const canceled = await cancelMeeting(ctx!.current!, "Canceled by the contact");
  await sendInvite(canceled, ctx!.cc, "CANCEL").catch(() => undefined);
  redirect(`/b/${token}?canceled=1`);
}
