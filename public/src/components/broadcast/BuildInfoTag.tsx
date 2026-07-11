"use client";

/**
 * Tiny bottom-right build stamp — version numbers for the three main
 * processes (public/socket/worker), polling the same /api/status the Home and
 * Admin status panels use. Purely a control-room watermark: self-hides on
 * fetch failure rather than showing an error on air.
 */
import { useEffect, useState } from "react";

interface ServiceStatus {
  name: string;
  version: string | null;
}

const MAIN_SERVICES = ["public", "socket", "worker"];
const POLL_MS = 120_000; // build SHA only changes on deploy — no need to poll /api/status often

export default function BuildInfoTag() {
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
  const main = services.filter((s) => MAIN_SERVICES.includes(s.name) && s.version);
  if (!main.length) return null;

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10,
        letterSpacing: 0.2,
        color: "#5c7a94",
        textShadow: "0 1px 3px rgba(0,0,0,0.9)",
        pointerEvents: "none",
      }}
    >
      {main.map((s) => (
        <span key={s.name}>
          {s.name} v{s.version}
        </span>
      ))}
    </div>
  );
}
