import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Wix ↔ HubSpot Sync",
  description: "Reliable bidirectional contact synchronization between Wix and HubSpot.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
