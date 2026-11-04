import { notFound, redirect } from "next/navigation";
import { fillTemplate } from "@/lib/render";
import { companyFromEmail, varsFor } from "@/lib/engine/send";
import { resolveBooking, recordBookingVisit } from "@/lib/meetings/booking";
import { availabilityFor, busyFor, hostFor } from "@/lib/meetings/record";
import { availableSlots } from "@/lib/meetings/slots";
import { prefillBookingUrl } from "@/lib/meetings/webhook";
import { cancelBooking } from "@/app/actions/booking";
import { LocalTime, SlotPicker } from "./SlotPicker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book a time", robots: { index: false, follow: false } };

/**
 * The link interested contacts receive. Built-in mode: pick a free time, get a calendar invite.
 * External mode: forwards to Calendly / Cal.com / Google with name and email filled in.
 */
export default async function BookingPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<Record<string, string>> }) {
  const { token } = await params;
  const sp = await searchParams;
  const ctx = await resolveBooking(token);
  if (!ctx) notFound();
  const { cc, message, current } = ctx;
  const { campaign, contact, mailbox } = cc;

  const fresh = !sp.booked && !sp.canceled && !sp.error;
  if (message && fresh) await recordBookingVisit(message);

  const name = [contact.firstName, contact.lastName].filter(Boolean).join(" ");
  if (campaign.bookingMode === "EXTERNAL" && campaign.bookingUrl && fresh) {
    redirect(prefillBookingUrl(campaign.bookingUrl, { name, email: contact.email }, cc.id));
  }

  const sender = mailbox?.displayName || "us";
  const company = companyFromEmail(mailbox?.email);
  const title = fillTemplate(campaign.meetingTitle, varsFor(contact, mailbox, cc.variables)).trim() || "Intro call";
  const initials = sender.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  const where = campaign.meetingLocation ? (/^https?:\/\//.test(campaign.meetingLocation) ? "Video call" : campaign.meetingLocation) : "Details in the invite";
  const isTest = campaign.mode === "TEST";

  let slots: string[] = [];
  if (campaign.bookingMode === "BUILT_IN") {
    const busy = await busyFor(hostFor(campaign, mailbox), current?.id);
    slots = availableSlots(availabilityFor(campaign), busy).map((d) => d.toISOString());
  }

  return (
    <main className="bk">
      <div className="bk-card">
        {isTest ? <div className="bk-test">Test booking page: the invite is captured in the test inbox, nobody receives it.</div> : null}
        <header className="bk-head">
          <span className="bk-avatar" aria-hidden="true">{initials || "•"}</span>
          <div>
            <p className="bk-eyebrow">{company && !sender.toLowerCase().includes(company.toLowerCase()) ? `${sender} · ${company}` : sender}</p>
            <h1>{title}</h1>
            <p className="bk-meta">{campaign.meetingDurationMin} minutes · {where}</p>
          </div>
        </header>

        {sp.error === "taken" ? <p className="bk-alert">That time was just taken. Please pick another one.</p> : null}

        {current ? (
          <section className="bk-done">
            <h2>{sp.booked ? "You're booked" : "Your meeting"}</h2>
            <p className="bk-when"><LocalTime iso={current.startsAt!.toISOString()} /></p>
            <p className="bk-muted">
              {sp.invite === "failed"
                ? "We couldn't send the calendar invite automatically. We'll send it by email shortly."
                : `A calendar invite ${sp.booked ? "is on its way" : "was sent"} to ${contact.email}.`}
            </p>
            <form action={cancelBooking}>
              <input type="hidden" name="token" value={token} />
              <button className="bk-link" type="submit">Cancel this meeting</button>
            </form>
            {campaign.bookingMode === "BUILT_IN" ? <h3 className="bk-sub">Need another time?</h3> : null}
          </section>
        ) : sp.canceled ? (
          <section className="bk-done"><h2>Meeting canceled</h2><p className="bk-muted">You can pick a new time below whenever suits you.</p></section>
        ) : null}

        {campaign.bookingMode === "BUILT_IN" ? (
          <SlotPicker token={token} slots={slots} duration={campaign.meetingDurationMin} rescheduling={Boolean(current)} />
        ) : campaign.bookingMode === "EXTERNAL" && campaign.bookingUrl ? (
          <p><a className="bk-btn" href={prefillBookingUrl(campaign.bookingUrl, { name, email: contact.email }, cc.id)}>Choose a time</a></p>
        ) : (
          <p className="bk-muted">Just reply to the email with a couple of times that suit you and {sender.split(" ")[0]} will send an invite.</p>
        )}
      </div>
      <p className="bk-foot">Booking for {contact.email}</p>
    </main>
  );
}
