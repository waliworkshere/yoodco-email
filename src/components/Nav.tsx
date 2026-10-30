"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { IconCampaigns, IconMailbox, IconOverview, IconSettings } from "./icons";

const items = [
  { href: "/", label: "Overview", icon: IconOverview, match: (p: string) => p === "/" },
  { href: "/campaigns", label: "Campaigns", icon: IconCampaigns, match: (p: string) => p.startsWith("/campaigns") },
  { href: "/mailboxes", label: "Mailboxes", icon: IconMailbox, match: (p: string) => p.startsWith("/mailboxes") },
  { href: "/settings", label: "Settings", icon: IconSettings, match: (p: string) => p.startsWith("/settings") },
];

export function Nav() {
  const path = usePathname() ?? "/";
  return (
    <nav className="nav" aria-label="Main">
      {items.map(({ href, label, icon: Icon, match }) => (
        <Link key={href} href={href} aria-current={match(path) ? "page" : undefined}>
          <Icon /> {label}
        </Link>
      ))}
    </nav>
  );
}
