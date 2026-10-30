"use client";
import { useActionState } from "react";
import { login } from "../actions/auth";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="form">
      <input type="hidden" name="next" value={next} />
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" name="email" type="email" className="input" autoComplete="username" required autoFocus />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" className="input" autoComplete="current-password" required />
      </div>
      {state?.error ? <p className="small" style={{ color: "var(--bad)" }} role="alert">{state.error}</p> : null}
      <button className="btn btn-primary" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
