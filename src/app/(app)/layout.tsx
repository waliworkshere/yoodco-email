import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { workerStatus } from "@/lib/stats";
import { Nav } from "@/components/Nav";
import { logout } from "../actions/auth";
import { fmtRelative } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const worker = await workerStatus();
  const workerLabel =
    worker.state === "online" ? "Sender running" : worker.state === "offline" ? `Sender idle · ${fmtRelative(worker.hb?.lastBeat)}` : "Sender not started";
  return (
    <>
      <header className="topbar">
        <div className="topbar-in">
          <Link className="brand" href="/">
            <img src="/logo.png" alt="" />
            <span>Yood<small>Outreach</small></span>
          </Link>
          <Nav />
          <div className="top-right">
            <span className={`live-dot ${worker.state}`} title="The sender that paces and sends emails">{workerLabel}</span>
            <span className="who">{user.name}</span>
            <form action={logout}><button className="linkish" type="submit">Sign out</button></form>
          </div>
        </div>
      </header>
      <main className="main">
        <div className="container">{children}</div>
      </main>
      <footer className="footer">
        <div className="footer-in">
          <span>Yood Outreach · paced sequences from your own mailboxes</span>
          <span>Signed in as {user.email}</span>
        </div>
      </footer>
    </>
  );
}
