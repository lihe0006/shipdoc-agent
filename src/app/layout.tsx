import type { Metadata } from "next";
// Self-hosted Inter (no build-time download from Google Fonts).
import "@fontsource-variable/inter";
import "./globals.css";

export const metadata: Metadata = {
  title: "Shipment document check",
  description: "Upload K1, CIPL, BL and Form E — the agent compares every field and flags mismatches.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
