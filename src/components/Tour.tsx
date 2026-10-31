"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Guided tour: highlights one part of the page at a time with a short explanation.
 * Starts by itself the first time someone sees the page (remembered per browser),
 * and can be replayed from the "Tour" button in the top bar.
 */
export interface TourStep {
  target?: string; // CSS selector; leave out for a centred message
  title: string;
  body: string;
}

const START_EVENT = "yood:start-tour";
const storeKey = (id: string) => `yood-tour:${id}`;

function seen(id: string) {
  try {
    return localStorage.getItem(storeKey(id)) === "done";
  } catch {
    return true; // storage blocked: do not keep re-opening the tour
  }
}
function markSeen(id: string) {
  try {
    localStorage.setItem(storeKey(id), "done");
  } catch {
    /* storage blocked */
  }
}

type Box = { top: number; left: number; width: number; height: number } | null;

export function Tour({ id, steps }: { id: string; steps: TourStep[] }) {
  const [open, setOpen] = useState(false);
  const [i, setI] = useState(0);
  const [box, setBox] = useState<Box>(null);
  const [card, setCard] = useState<{ top: number; left: number; mobile: boolean }>({ top: 0, left: 0, mobile: false });
  const cardRef = useRef<HTMLDivElement>(null);
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();

  const start = useCallback(() => {
    setI(0);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    markSeen(id);
    setOpen(false);
    if (params.get("tour")) router.replace(path);
  }, [id, params, path, router]);

  // Auto-start on first visit, or when asked with ?tour=1
  useEffect(() => {
    if (params.get("tour") === "1" || !seen(id)) {
      const t = setTimeout(start, 700);
      return () => clearTimeout(t);
    }
  }, [id, params, start]);

  // "Tour" button in the top bar
  useEffect(() => {
    const onStart = (e: Event) => {
      e.preventDefault(); // tells the button a tour exists on this page
      start();
    };
    window.addEventListener(START_EVENT, onStart);
    return () => window.removeEventListener(START_EVENT, onStart);
  }, [start]);

  const step = steps[i];

  // Find the highlighted element, bring it into view, and place the card next to it
  const measure = useCallback(() => {
    if (!open || !step) return;
    const mobile = window.innerWidth < 640;
    const el = step.target ? (document.querySelector(step.target) as HTMLElement | null) : null;
    const visible = el && el.getClientRects().length > 0;
    if (!visible) {
      setBox(null);
      setCard({ top: 0, left: 0, mobile });
      return;
    }
    const r = el!.getBoundingClientRect();
    const pad = 8;
    const b = { top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 };
    setBox(b);
    const cw = cardRef.current?.offsetWidth ?? 380;
    const ch = cardRef.current?.offsetHeight ?? 200;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const clampTop = (t: number) => Math.min(Math.max(12, t), vh - ch - 12);
    const clampLeft = (l: number) => Math.min(Math.max(12, l), vw - cw - 12);
    let top: number;
    let left: number;
    if (b.top + b.height + 14 + ch <= vh - 12) {
      top = b.top + b.height + 14; // below
      left = clampLeft(b.left);
    } else if (b.top - ch - 14 >= 12) {
      top = b.top - ch - 14; // above
      left = clampLeft(b.left);
    } else if (b.left + b.width + 16 + cw <= vw - 12) {
      left = b.left + b.width + 16; // right
      top = clampTop(b.top);
    } else if (b.left - cw - 16 >= 12) {
      left = b.left - cw - 16; // left
      top = clampTop(b.top);
    } else {
      setCard({ top: 0, left: 0, mobile: true }); // no room: dock at the bottom
      return;
    }
    setCard({ top, left, mobile });
  }, [open, step]);

  useEffect(() => {
    if (!open || !step?.target) return;
    const el = document.querySelector(step.target) as HTMLElement | null;
    if (el && el.getClientRects().length) {
      const r = el.getBoundingClientRect();
      // Keep the highlight clear of the sticky top bar (and of the docked card on phones)
      const header = (document.querySelector(".topbar") as HTMLElement | null)?.offsetHeight ?? 0;
      const fixedBar = getComputedStyle(document.querySelector(".topbar") ?? document.body).position === "sticky";
      const topSpace = (fixedBar ? header : 0) + 16;
      const bottomSpace = window.innerWidth < 640 ? 280 : 24;
      const fits = r.top >= topSpace && r.bottom <= window.innerHeight - bottomSpace;
      if (!fits) {
        const room = window.innerHeight - topSpace - bottomSpace;
        const y = r.height <= room ? r.top + window.scrollY - topSpace - (room - r.height) / 2 : r.top + window.scrollY - topSpace;
        window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
      }
    }
    const t = setTimeout(measure, 450);
    return () => clearTimeout(t);
  }, [open, step, measure]);

  useLayoutEffect(() => {
    measure();
  }, [measure, i]);

  useEffect(() => {
    if (!open) return;
    const on = () => measure();
    window.addEventListener("resize", on);
    window.addEventListener("scroll", on, true);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "ArrowRight") setI((n) => Math.min(n + 1, steps.length - 1));
      if (e.key === "ArrowLeft") setI((n) => Math.max(n - 1, 0));
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", on);
      window.removeEventListener("scroll", on, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, measure, close, steps.length]);

  if (!open || !step) return null;
  const last = i === steps.length - 1;
  const centred = !box;

  return (
    <div className="tour" role="dialog" aria-modal="true" aria-labelledby="tour-title">
      {box ? (
        <div className="tour-spot" style={{ top: box.top, left: box.left, width: box.width, height: box.height }} />
      ) : (
        <div className="tour-scrim" />
      )}
      <div
        ref={cardRef}
        className={`tour-card${card.mobile ? " docked" : ""}${centred && !card.mobile ? " centred" : ""}`}
        style={card.mobile || centred ? undefined : { top: card.top, left: card.left }}
      >
        <div className="tour-meta">
          <span className="eyebrow">Step {i + 1} of {steps.length}</span>
          <button type="button" className="tour-skip" onClick={close}>Skip tour</button>
        </div>
        <h3 id="tour-title">{step.title}</h3>
        <p>{step.body}</p>
        <div className="tour-foot">
          <div className="tour-dots" aria-hidden="true">
            {steps.map((_, k) => <span key={k} className={k === i ? "on" : ""} />)}
          </div>
          <div className="row" style={{ gap: 8 }}>
            {i > 0 ? <button type="button" className="btn btn-sm" onClick={() => setI(i - 1)}>Back</button> : null}
            <button type="button" className="btn btn-sm btn-primary" onClick={() => (last ? close() : setI(i + 1))} autoFocus>
              {last ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Top-bar button: replays this page's tour, or goes to the overview tour on pages without one. */
export function TourButton() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="tour-btn"
      onClick={() => {
        const handled = !window.dispatchEvent(new CustomEvent(START_EVENT, { cancelable: true }));
        if (!handled) router.push("/?tour=1");
      }}
      title="Show me around"
    >
      <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M9.6 9.2a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.6M12 17h.01" />
      </svg>
      <span>Tour</span>
    </button>
  );
}
