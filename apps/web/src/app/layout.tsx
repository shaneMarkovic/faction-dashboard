import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Torn Faction Dashboard",
  description: "Real-time multi-faction command center for Torn City",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // System font stack (Tahoma/Segoe/Verdana) is set in globals.css — no web font
  // load, which is both period-accurate and faster.
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">{children}</body>
    </html>
  );
}
