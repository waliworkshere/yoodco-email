"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

/**
 * On phones, wide tables are shown as stacked cards. This copies each column's heading
 * onto its cells (data-label) so the card can show "Status: Replied" style rows.
 */
function label(root: ParentNode) {
  root.querySelectorAll<HTMLTableElement>("main table").forEach((table) => {
    const heads = Array.from(table.querySelectorAll("thead th")).map((th) => th.textContent?.trim() ?? "");
    if (!heads.length) return;
    table.classList.add("stackable");
    table.querySelectorAll("tbody tr").forEach((tr) => {
      Array.from(tr.children).forEach((td, i) => {
        const el = td as HTMLElement;
        if (heads[i] && el.dataset.label !== heads[i]) el.dataset.label = heads[i];
      });
    });
  });
}

export function TableLabels() {
  const path = usePathname();
  useEffect(() => {
    label(document);
    const main = document.querySelector("main");
    if (!main) return;
    const obs = new MutationObserver(() => label(document));
    obs.observe(main, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, [path]);
  return null;
}
