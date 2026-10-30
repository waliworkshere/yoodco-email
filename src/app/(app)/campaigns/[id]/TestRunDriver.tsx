"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { advanceTestRun } from "@/app/actions/live";

/** Keeps a test run moving while this page is open, and refreshes the numbers. */
export function TestRunDriver({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const busy = useRef(false);
  useEffect(() => {
    let stopped = false;
    const step = async () => {
      if (busy.current || stopped || document.hidden) return;
      busy.current = true;
      try {
        const r = await advanceTestRun(campaignId);
        router.refresh();
        if (!r.running) stopped = true;
      } catch {
        /* try again on the next interval */
      } finally {
        busy.current = false;
      }
    };
    const t = setInterval(step, 4000);
    void step();
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [campaignId, router]);
  return null;
}
