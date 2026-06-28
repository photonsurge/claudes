import type { Metadata } from "next";
import { SocketProvider } from "../lib/socket-provider";

export const metadata: Metadata = {
  title: "Live Weather Globe",
  description: "Live weather globe — broadcast (/watch), operator (/control), cities (/cities)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", margin: 0 }}>
        <SocketProvider>{children}</SocketProvider>
      </body>
    </html>
  );
}
