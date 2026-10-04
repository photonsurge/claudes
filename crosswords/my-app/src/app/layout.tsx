import type { Metadata } from "next";
import { Providers } from "../providers";
import AppShell from "@/lib/components/AppShell";
import "./globals.css";

export const metadata: Metadata = {
  title: "Thronix Saturn",
  description: "Next.js + MUI",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
