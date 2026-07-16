"use client";

/**
 * Reads /api/status and renders each service's up/down dot + version. `compact`
 * (Home page) is a single quiet row; the full form (Admin page) is a bordered
 * card with per-service detail on failure.
 */
import { useEffect, useState } from "react";

interface ServiceStatus {
  name: string;
  version: string | null;
  status: "ok" | "down";
  detail?: string;
}

const POLL_MS = 30_000;
const DOT_COLOR: Record<ServiceStatus["status"], string> = { ok: "#22c55e", down: "#ef4444" };

export default function ServiceStatusPanel({ compact = false }: { compact?: boolean }) {
  const [services, setServices] = useState<ServiceStatus[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/status", { cache: "no-store" });
        const data = await res.json();
        if (!cancelled) setServices(data.services ?? null);
      } catch {
        if (!cancelled) setServices(null);
      }
    };
    load();
    const id = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!services) return null;

  if (compact) {
    return (
      <div style={{ display: "flex", gap: 14, flexWrap: "wrap", justifyContent: "center", fontSize: 12 }}>
        {services.map((s) => (
          <span key={s.name} title={s.detail} style={{ display: "flex", alignItems: "center", gap: 5, color: "#8b95a7" }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: DOT_COLOR[s.status] }} />
            {s.name}
            {s.version && <span style={{ color: "#5b6577" }}>v{s.version}</span>}
          </span>
        ))}
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 16,
        borderRadius: 8,
        border: "1px solid #1b2030",
        background: "#0c111c",
      }}
    >
      <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Services</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
        {services.map((s) => (
          <div key={s.name} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: DOT_COLOR[s.status], flexShrink: 0 }} />
            <span style={{ color: "#fff" }}>{s.name}</span>
            {/*
              Version sits with its own name, NOT `marginLeft: auto`. Right-aligning
              it inside an auto-fill grid cell parked it against the *next*
              service's dot, so every version read as belonging to the wrong
              service ("public  v0.1.62 ● socket").
            */}
            <span style={{ color: "#5b6577", fontFamily: "ui-monospace, monospace", fontVariantNumeric: "tabular-nums" }}>
              {s.version ? `v${s.version}` : s.detail || "down"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
