import type { Campaign, CampaignStep } from "@prisma/client";
import { updateCampaignSettings } from "@/app/actions/campaigns";
import { SubmitButton } from "@/components/buttons";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export function SettingsTab({ campaign: c }: { campaign: Campaign & { steps: CampaignStep[] } }) {
  return (
    <form action={updateCampaignSettings} className="stack" style={{ gap: 20 }}>
      <input type="hidden" name="id" value={c.id} />

      <section className="card" id="meetings">
        <div className="card-head"><h2>Meetings</h2><p>How interested contacts book a call. Every booking shows up under Meetings and stops their follow-ups.</p></div>
        <div className="card-body form">
          <div className="fields">
            <fieldset className="field span-2 choice-row">
              <legend className="label">Booking</legend>
              <label className="choice"><input type="radio" name="bookingMode" value="BUILT_IN" defaultChecked={c.bookingMode === "BUILT_IN"} /><span><b>Built-in booking page</b><span className="hint">They pick a free time; a calendar invite goes to them and the host. Nothing else to set up.</span></span></label>
              <label className="choice"><input type="radio" name="bookingMode" value="EXTERNAL" defaultChecked={c.bookingMode === "EXTERNAL"} /><span><b>My own booking link</b><span className="hint">Calendly, Cal.com, Google appointment schedule, HubSpot. Checks your real calendar.</span></span></label>
              <label className="choice"><input type="radio" name="bookingMode" value="OFF" defaultChecked={c.bookingMode === "OFF"} /><span><b>Off</b><span className="hint">Replies are only flagged; you answer them yourself.</span></span></label>
            </fieldset>
            <div className="field span-2">
              <label htmlFor="bookingUrl">Booking link (for &quot;My own booking link&quot;)</label>
              <input id="bookingUrl" name="bookingUrl" type="url" className="input" defaultValue={c.bookingUrl ?? ""} placeholder="https://calendly.com/lionel/intro" />
              <span className="hint">The contact&apos;s name and email are filled in for them. For bookings to be counted automatically, add the webhook from Settings → Calendar tools.</span>
            </div>
            <div className="field">
              <label htmlFor="meetingTitle">Meeting title</label>
              <input id="meetingTitle" name="meetingTitle" className="input" defaultValue={c.meetingTitle} />
            </div>
            <div className="field">
              <label htmlFor="meetingHostEmail">Who takes the meetings</label>
              <input id="meetingHostEmail" name="meetingHostEmail" type="email" className="input" defaultValue={c.meetingHostEmail ?? ""} placeholder="Leave empty: the sending mailbox" />
              <span className="hint">Gets the calendar invite too, e.g. lionel@yood.co.</span>
            </div>
            <div className="field">
              <label htmlFor="meetingVideo">Video</label>
              <select id="meetingVideo" name="meetingVideo" className="input" defaultValue={c.meetingVideo}>
                <option value="LINK">The link below</option>
                <option value="ZOOM">Zoom: a new meeting for each booking</option>
              </select>
              <span className="hint">Connect Zoom in Settings first.</span>
            </div>
            <div className="field">
              <label htmlFor="meetingLocation">Video link or phone</label>
              <input id="meetingLocation" name="meetingLocation" className="input" defaultValue={c.meetingLocation ?? ""} placeholder="https://meet.google.com/abc-defg-hij" />
            </div>
            <div className="field">
              <label htmlFor="meetingDurationMin">Length</label>
              <select id="meetingDurationMin" name="meetingDurationMin" className="input" defaultValue={String(c.meetingDurationMin)}>
                {[15, 20, 30, 45, 60].map((n) => <option key={n} value={n}>{n} minutes</option>)}
              </select>
            </div>
            <div className="field span-2">
              <span className="label">Bookable days and hours (built-in page, in {c.timezone.replace(/_/g, " ")})</span>
              <div className="days">
                {DAYS.map((d, i) => (
                  <label key={d}><input type="checkbox" name="meetingDays" value={i} defaultChecked={c.meetingDays.includes(i)} /> {d}</label>
                ))}
              </div>
              <div className="row" style={{ gap: 8, marginTop: 8 }}>
                <input aria-label="Bookable from" name="meetingStart" type="time" className="input" style={{ width: 130 }} defaultValue={hhmm(c.meetingStart)} />
                <span className="small muted">to</span>
                <input aria-label="Bookable until" name="meetingEnd" type="time" className="input" style={{ width: 130 }} defaultValue={hhmm(c.meetingEnd)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="meetingNoticeHours">Earliest booking</label>
              <input id="meetingNoticeHours" name="meetingNoticeHours" type="number" min={0} className="input" defaultValue={c.meetingNoticeHours} />
              <span className="hint">Hours from now.</span>
            </div>
            <div className="field">
              <label htmlFor="meetingHorizonDays">Latest booking</label>
              <input id="meetingHorizonDays" name="meetingHorizonDays" type="number" min={1} className="input" defaultValue={c.meetingHorizonDays} />
              <span className="hint">Days ahead.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Answering interested replies</h2><p>Every reply is sorted: interested, a question, not now, not interested, remove me, wrong person.</p></div>
        <div className="card-body form">
          <div className="fields">
            <label className="check" style={{ gridColumn: "1 / -1" }}><input type="checkbox" name="autoBookingReply" defaultChecked={c.autoBookingReply} /><span><span className="label">Send the booking link to interested replies automatically</span><br /><span className="hint">In the same thread, from the same mailbox. Questions and everything else are left for a person.</span></span></label>
            <div className="field">
              <label htmlFor="bookingReplyMinDelay">Wait at least</label>
              <input id="bookingReplyMinDelay" name="bookingReplyMinDelay" type="number" min={0} className="input" defaultValue={c.bookingReplyMinDelay} />
              <span className="hint">Minutes after their reply.</span>
            </div>
            <div className="field">
              <label htmlFor="bookingReplyMaxDelay">and at most</label>
              <input id="bookingReplyMaxDelay" name="bookingReplyMaxDelay" type="number" min={0} className="input" defaultValue={c.bookingReplyMaxDelay} />
              <span className="hint">A random wait reads like a person.</span>
            </div>
            <div className="field span-2">
              <label htmlFor="bookingReplyText">The reply</label>
              <textarea id="bookingReplyText" name="bookingReplyText" className="textarea" rows={8} defaultValue={c.bookingReplyText} />
              <span className="hint">Must contain {"{{bookingLink}}"}. You can also put {"{{bookingLink}}"} in Email 2 or 3.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Pacing</h2><p>How fast this campaign sends. Each mailbox also has its own limits.</p></div>
        <div className="card-body form">
          <div className="fields fields-3">
            <div className="field span-2">
              <label htmlFor="name">Campaign name</label>
              <input id="name" name="name" className="input" defaultValue={c.name} />
            </div>
            <div className="field">
              <label htmlFor="hourlyLimit">Emails per hour</label>
              <input id="hourlyLimit" name="hourlyLimit" type="number" min={1} max={500} className="input" defaultValue={c.hourlyLimit} />
              <span className="hint">Across all mailboxes in this campaign.</span>
            </div>
            <div className="field">
              <label htmlFor="minGapSeconds">Shortest gap between emails</label>
              <input id="minGapSeconds" name="minGapSeconds" type="number" min={10} className="input" defaultValue={c.minGapSeconds} />
              <span className="hint">Seconds</span>
            </div>
            <div className="field">
              <label htmlFor="maxGapSeconds">Longest gap between emails</label>
              <input id="maxGapSeconds" name="maxGapSeconds" type="number" min={10} className="input" defaultValue={c.maxGapSeconds} />
              <span className="hint">A random gap in this range keeps sends from looking automated.</span>
            </div>
            <div className="field">
              <label htmlFor="timezone">Time zone</label>
              <input id="timezone" name="timezone" className="input" defaultValue={c.timezone} />
              <span className="hint">e.g. Asia/Dubai, Europe/London</span>
            </div>
            <div className="field">
              <label htmlFor="windowStart">Send from</label>
              <input id="windowStart" name="windowStart" type="time" className="input" defaultValue={hhmm(c.windowStart)} />
            </div>
            <div className="field">
              <label htmlFor="windowEnd">Until</label>
              <input id="windowEnd" name="windowEnd" type="time" className="input" defaultValue={hhmm(c.windowEnd)} />
            </div>
            <div className="field span-2">
              <span className="label">Sending days</span>
              <div className="days">
                {DAYS.map((d, i) => (
                  <label key={d}><input type="checkbox" name="sendDays" value={i} defaultChecked={c.sendDays.includes(i)} /> {d}</label>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Sequence</h2><p>Copy from the sheet is used for each contact. The text below is only used when a contact&apos;s row is empty for that email.</p></div>
        <div className="card-body form">
          {c.steps.map((s) => (
            <div key={s.id} className="fields" style={{ paddingBottom: 16, borderBottom: "1px solid var(--line)" }}>
              <div className="field">
                <span className="label">Email {s.order}</span>
                {s.order === 1 ? (
                  <span className="hint">Sent first.</span>
                ) : (
                  <label className="row small" htmlFor={`delay_${s.order}`} style={{ gap: 8 }}>
                    Wait <input id={`delay_${s.order}`} name={`delay_${s.order}`} type="number" min={0} max={90} className="input" style={{ width: 80 }} defaultValue={s.delayDays} /> days after Email {s.order - 1}
                  </label>
                )}
              </div>
              <div className="field">
                <label htmlFor={`subject_${s.order}`}>Fallback subject</label>
                <input id={`subject_${s.order}`} name={`subject_${s.order}`} className="input" defaultValue={s.subject} placeholder="Used only if the sheet has none" />
              </div>
              <div className="field span-2">
                <label htmlFor={`body_${s.order}`}>Fallback body</label>
                <textarea id={`body_${s.order}`} name={`body_${s.order}`} className="textarea" defaultValue={s.body} placeholder={"Hi {{firstName|there}},\n\n…"} />
                <span className="hint">Placeholders: {"{{firstName}}"}, {"{{lastName}}"}, {"{{companyName}}"}, {"{{senderName}}"}, {"{{senderFirstName}}"}, any sheet column. Add a fallback with {"{{firstName|there}}"}.</span>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Tracking and stopping rules</h2></div>
        <div className="card-body form">
          <div className="fields">
            <label className="check"><input type="checkbox" name="trackOpens" defaultChecked={c.trackOpens} /><span><span className="label">Track opens</span><br /><span className="hint">Adds an invisible image. Turning it off can help deliverability on first emails.</span></span></label>
            <label className="check"><input type="checkbox" name="trackClicks" defaultChecked={c.trackClicks} /><span><span className="label">Track clicks</span><br /><span className="hint">Links pass through this app, then forward instantly.</span></span></label>
            <label className="check"><input type="checkbox" name="stopOnReply" defaultChecked={c.stopOnReply} /><span><span className="label">Stop when the contact replies</span><br /><span className="hint">Out-of-office replies do not count.</span></span></label>
            <label className="check"><input type="checkbox" name="stopOnDomainReply" defaultChecked={c.stopOnDomainReply} /><span><span className="label">Stop for the whole company when anyone there replies</span><br /><span className="hint">Ignores free-mail domains like gmail.com.</span></span></label>
            <label className="check"><input type="checkbox" name="threadFollowUps" defaultChecked={c.threadFollowUps} /><span><span className="label">Send follow-ups in the same thread</span><br /><span className="hint">Emails 2+ go out as &quot;Re: &lt;first subject&gt;&quot; instead of their own subject.</span></span></label>
            <label className="check"><input type="checkbox" name="unsubscribeFooter" defaultChecked={c.unsubscribeFooter} /><span><span className="label">Add an opt-out line</span><br /><span className="hint">Also adds the one-click unsubscribe header Gmail and Outlook look for.</span></span></label>
            <div className="field span-2">
              <label htmlFor="unsubscribeText">Opt-out line</label>
              <input id="unsubscribeText" name="unsubscribeText" className="input" defaultValue={c.unsubscribeText} />
              <span className="hint">Must contain {"{{unsubscribeUrl}}"}.</span>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Test mode</h2><p>Only applies while the campaign is in test mode.</p></div>
        <div className="card-body form">
          <div className="fields">
            <label className="check"><input type="checkbox" name="testFastForward" defaultChecked={c.testFastForward} /><span><span className="label">Fast-forward</span><br /><span className="hint">A day of delay lasts one minute and the sending window and limits are ignored, so a whole sequence plays out in minutes. Turn off to rehearse real timing.</span></span></label>
            <div className="field">
              <label htmlFor="testRedirectTo">Send test emails to a real inbox</label>
              <input id="testRedirectTo" name="testRedirectTo" type="email" className="input" defaultValue={c.testRedirectTo ?? ""} placeholder="you@yood.ai (optional)" />
              <span className="hint">Leave empty to capture everything in the test inbox. If set, every test email is really sent from its mailbox to this address, so you can check inbox placement.</span>
            </div>
          </div>
        </div>
      </section>

      <div className="form-foot" style={{ border: 0, paddingTop: 0 }}>
        <SubmitButton pending="Saving…">Save settings</SubmitButton>
      </div>
    </form>
  );
}
