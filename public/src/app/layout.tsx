/**
 * Root layout. Wraps every page in SocketProvider so /watch, /control and
 * /cities share one authenticated socket connection.
 */
import type { Metadata } from "next";
import { SocketProvider } from "../lib/socket-provider";
import { DebugUIProvider } from "../lib/client/debug-ui";

export const metadata: Metadata = {
  title: "Live Weather Globe",
  description: "Live weather globe — broadcast (/watch), operator (/control), cities (/cities)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <DebugUIProvider>
          <SocketProvider>{children}</SocketProvider>
        </DebugUIProvider>
      </body>
    </html>
  );
}
