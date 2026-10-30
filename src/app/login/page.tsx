import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  if (await getSession()) redirect("/");
  const { next } = await searchParams;
  return (
    <main className="auth">
      <div className="card">
        <div className="brand">
          <img src="/logo.png" alt="" />
          <span>Yood<small>Outreach</small></span>
        </div>
        <div>
          <h1 style={{ fontSize: 22 }}>Welcome back</h1>
          <p className="muted small" style={{ marginTop: 4 }}>Sign in to manage your outreach.</p>
        </div>
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}
