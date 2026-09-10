/**
 * Root layout. Wraps every page in SocketProvider so /watch, /control and
 * /cities share one authenticated socket connection.
 */
import type { Metadata } from "next";
import "./globals.css";
import { UI_SANS } from "../lib/fonts";
import { SocketProvider } from "../lib/socket-provider";
import { DebugUIProvider } from "../lib/client/debug-ui";
// Masthead faces (Saira + JetBrains Mono). Kept inline: GodsBanner exports the
// same href, but that module is "use client" and this layout is a server
// component, so a value import across the boundary would fail.
const GODS_FONT_HREF =
  "https://fonts.googleapis.com/css2?family=Saira:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap";
// Flag emoji, served by us rather than by whatever fonts the viewing machine
// owns — OBS's Chromium owns none, so flags came out as .notdef boxes on air.
// Preloaded (not left to unicode-range's lazy fetch) because the first cut can
// carry a flag, and a broadcast has no second chance at its first frame.
export const FLAG_FONT_HREF = "/fonts/noto-color-emoji-flags.woff2";

export const metadata: Metadata = {
  title: "Live Weather Globe",
  description: "Live weather globe — broadcast (/watch), operator (/control), cities (/cities)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: UI_SANS, margin: 0 }}>
        <link rel="preload" as="font" type="font/woff2" href={FLAG_FONT_HREF} crossOrigin="anonymous" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={GODS_FONT_HREF} />
        <DebugUIProvider>
          <SocketProvider>{children}</SocketProvider>
        </DebugUIProvider>
      </body>
    </html>
  );
}
