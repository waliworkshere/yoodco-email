import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { deleteCampaign, duplicateCampaign, pauseCampaign, resetTestRun, startCampaign } from "@/app/actions/campaigns";
import { ConfirmButton, SubmitButton } from "@/components/buttons";
import { IconPause, IconPlay } from "@/components/icons";
import { CampaignStatusBadge, Flash, ModeBadge } from "@/components/ui";
import { OverviewTab } from "./OverviewTab";
import { ContactsTab } from "./ContactsTab";
import { EmailsTab } from "./EmailsTab";
import { ActivityTab } from "./ActivityTab";
import { SettingsTab } from "./SettingsTab";
import { LaunchTab } from "./LaunchTab";
import { TestRunDriver } from "./TestRunDriver";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const c = await db.campaign.findUnique({ where: { id: (await params).id }, select: { name: true } });
  return { title: c?.name ?? "Campaign" };
}

const TABS = [
  ["overview", "Overview"],
  ["contacts", "Contacts"],
  ["emails", "Emails"],
  ["activity", "Activity"],
  ["settings", "Settings"],
  ["launch", "Test & launch"],
] as const;

export default async function CampaignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string>> }) {
  const { id } = await params;
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab : "overview";
  const campaign = await db.campaign.findUnique({ where: { id }, include: { steps: { orderBy: { order: "asc" } } } });
  if (!campaign) notFound();
  const [contactCount, emailCount] = await Promise.all([
    db.campaignContact.count({ where: { campaignId: id } }),
    db.message.count({ where: { campaignId: id } }),
  ]);
  const isTest = campaign.mode === "TEST";
  const canStart = campaign.status === "DRAFT" || campaign.status === "PAUSED";

  return (
    <>
      <div className="page-head">
        <div className="title">
          <span className="crumbs"><Link href="/campaigns">Campaigns</Link> / {campaign.name}</span>
          <div className="title-row">
            <h1>{campaign.name}</h1>
            <CampaignStatusBadge status={campaign.status} />
            <ModeBadge mode={campaign.mode} />
          </div>
        </div>
        <div className="actions">
          {campaign.status === "RUNNING" ? (
            <form action={pauseCampaign}>
              <input type="hidden" name="id" value={id} />
              <SubmitButton className="btn" pending="Pausing…"><IconPause /> Pause</SubmitButton>
            </form>
          ) : null}
          {canStart ? (
            <form action={startCampaign}>
              <input type="hidden" name="id" value={id} />
              <SubmitButton className={isTest ? "btn btn-primary" : "btn btn-go"} pending="Starting…">
                <IconPlay /> {campaign.status === "PAUSED" ? "Resume" : isTest ? "Start test run" : "Start sending"}
              </SubmitButton>
            </form>
          ) : null}
          <details className="menu">
            <summary className="btn" aria-label="More actions">More</summary>
            <div className="menu-pop">
              <form action={duplicateCampaign}>
                <input type="hidden" name="id" value={id} />
                <button className="menu-item" type="submit">Duplicate</button>
              </form>
              <a className="menu-item" href={`/campaigns/${id}/export`}>Export results (.csv)</a>
              {isTest && emailCount > 0 ? (
                <form action={resetTestRun}>
                  <input type="hidden" name="id" value={id} />
                  <ConfirmButton className="menu-item" confirm="Click again to clear the test run">Reset test run</ConfirmButton>
                </form>
              ) : null}
              <form action={deleteCampaign}>
                <input type="hidden" name="id" value={id} />
                <ConfirmButton className="menu-item danger" confirm="Click again to delete">Delete campaign</ConfirmButton>
              </form>
            </div>
          </details>
        </div>
      </div>

      {isTest ? (
        <div className="test-banner">
          <span>
            <strong>Test mode.</strong>{" "}
            {campaign.testRedirectTo
              ? <>Every email goes to <b>{campaign.testRedirectTo}</b> instead of the real contact.</>
              : <>Emails are captured and never reach the contacts.</>}
            {campaign.testFastForward ? " Fast-forward is on: a day of delay lasts one minute and the sending window is ignored." : ""}
          </span>
          <span className="row" style={{ gap: 8 }}>
            {env.sandboxWebUrl && !campaign.testRedirectTo ? <a className="btn btn-sm" href={env.sandboxWebUrl} target="_blank" rel="noreferrer">Open Mailpit inbox</a> : null}
            <Link className="btn btn-sm" href={`/campaigns/${id}?tab=launch`}>Go live…</Link>
          </span>
        </div>
      ) : null}

      <Flash sp={sp} />
      {isTest && campaign.status === "RUNNING" ? <TestRunDriver campaignId={id} /> : null}

      <nav className="tabs" aria-label="Campaign sections">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/campaigns/${id}${key === "overview" ? "" : `?tab=${key}`}`} aria-current={tab === key ? "page" : undefined}>
            {label}
            {key === "contacts" ? <span className="count">{contactCount}</span> : null}
            {key === "emails" ? <span className="count">{emailCount}</span> : null}
          </Link>
        ))}
      </nav>

      {tab === "overview" ? <OverviewTab campaign={campaign} /> : null}
      {tab === "contacts" ? <ContactsTab campaign={campaign} sp={sp} /> : null}
      {tab === "emails" ? <EmailsTab campaign={campaign} sp={sp} /> : null}
      {tab === "activity" ? <ActivityTab campaign={campaign} sp={sp} /> : null}
      {tab === "settings" ? <SettingsTab campaign={campaign} /> : null}
      {tab === "launch" ? <LaunchTab campaign={campaign} /> : null}
    </>
  );
}
