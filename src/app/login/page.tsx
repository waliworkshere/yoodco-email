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
          <span className="brand-mark">Y</span>
          <span>Yoodco Email<small>Outbound sequences</small></span>
        </div>
        <LoginForm next={next ?? "/"} />
      </div>
    </main>
  );
}
