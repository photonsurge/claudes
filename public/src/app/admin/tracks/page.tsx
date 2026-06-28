"use client";

/**
 * /admin/tracks — live moving-object lists. One tab per source (satellites via
 * Celestrak/SGP4, aircraft via OpenSky, ships via aisstream). Each tab owns its
 * own fetch + table; the globe overlay (shared `Track` shape) comes later.
 */
import { useState } from "react";
import SatellitesTable from "../../../components/tracks/SatellitesTable";
import AircraftTable from "../../../components/tracks/AircraftTable";
import ShipsTable from "../../../components/tracks/ShipsTable";

type Tab = "satellites" | "aircraft" | "ships";
const TABS: { id: Tab; label: string }[] = [
  { id: "satellites", label: "Satellites" },
  { id: "aircraft", label: "Aircraft" },
  { id: "ships", label: "Ships" },
];

export default function TracksPage() {
  const [tab, setTab] = useState<Tab>("satellites");

  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1000, margin: "0 auto", padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Live tracks</h2>

        <div role="tablist" style={{ display: "flex", gap: 6, marginBottom: 16 }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              onClick={() => setTab(t.id)}
              style={{
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid #333",
                background: tab === t.id ? "#2563eb" : "#1a1f2b",
                color: "#fff",
                cursor: "pointer",
                fontSize: 13,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === "satellites" && <SatellitesTable />}
        {tab === "aircraft" && <AircraftTable />}
        {tab === "ships" && <ShipsTable />}
      </section>
    </main>
  );
}
