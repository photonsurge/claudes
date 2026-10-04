/**
 * Shared shell for the public /privacy and /terms pages — the links Google's
 * OAuth consent screen asks for. Static, anonymous, no client JS.
 */
import type { ReactNode } from "react";

export default function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "48px 20px", lineHeight: 1.6, color: "#e8eaed", background: "#101214", minHeight: "100vh" }}>
      <h1 style={{ fontWeight: 500, marginTop: 0 }}>{title}</h1>
      <p style={{ opacity: 0.6 }}>Last updated: 4 October 2026</p>
      {children}
      <p style={{ marginTop: 40 }}>
        <a href="/" style={{ color: "#8ab4f8" }}>← Back to the live globe</a>
      </p>
    </main>
  );
}
