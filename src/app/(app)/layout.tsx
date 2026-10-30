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
    worker.state === "online" ? "Sender running" : worker.state === "offline" ? `Sender offline · ${fmtRelative(worker.hb?.lastBeat)}` : "Sender not started";
  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">Y</span>
          <span>Yoodco Email<small>Outbound sequences</small></span>
        </div>
        <Nav />
        <div className="side-foot">
          <span className={`worker-dot ${worker.state}`} title="The background sender that paces and sends emails">{workerLabel}</span>
          <span className="who">{user.name} · {user.email}</span>
          <form action={logout}><button type="submit">Sign out</button></form>
        </div>
      </aside>
      <main className="main">
        <div className="container">{children}</div>
      </main>
    </div>
  );
}
