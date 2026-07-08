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
import ReplayPanel from "../../../components/tracks/ReplayPanel";
import AdminPageShell from "../../../components/admin/AdminPageShell";

type Tab = "satellites" | "aircraft" | "ships" | "replay";
const TABS: { id: Tab; label: string }[] = [
  { id: "satellites", label: "Satellites" },
  { id: "aircraft", label: "Aircraft" },
  { id: "ships", label: "Ships" },
  { id: "replay", label: "Replay" },
];

export default function TracksPage() {
  const [tab, setTab] = useState<Tab>("satellites");

  return (
    <AdminPageShell title="Live tracks" description="Satellites, aircraft, ships and replay tools." maxWidth={1000}>
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
      {tab === "replay" && <ReplayPanel />}
    </AdminPageShell>
  );
}
