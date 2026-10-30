"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";

/** Submit button that shows progress while its form's server action runs. */
export function SubmitButton({ children, pending, className = "btn btn-primary", name, value, disabled }: {
  children: ReactNode; pending?: string; className?: string; name?: string; value?: string; disabled?: boolean;
}) {
  const status = useFormStatus();
  return (
    <button type="submit" className={className} name={name} value={value} disabled={disabled || status.pending}>
      {status.pending ? pending ?? "Working…" : children}
    </button>
  );
}

/** Two-step button for actions that are hard to undo: first click arms it, second click submits. */
export function ConfirmButton({ children, confirm, className = "btn btn-danger", name, value }: {
  children: ReactNode; confirm: string; className?: string; name?: string; value?: string;
}) {
  const [armed, setArmed] = useState(false);
  const status = useFormStatus();
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), 5000);
    return () => clearTimeout(t);
  }, [armed]);
  if (!armed) {
    return (
      <button type="button" className={className} onClick={() => setArmed(true)}>
        {children}
      </button>
    );
  }
  return (
    <button type="submit" className={className} name={name} value={value} disabled={status.pending} autoFocus>
      {status.pending ? "Working…" : confirm}
    </button>
  );
}
