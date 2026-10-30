import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Yoodco Email", template: "%s · Yoodco Email" },
  description: "Paced outbound sequences from your own mailboxes, with open, click and reply tracking.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
