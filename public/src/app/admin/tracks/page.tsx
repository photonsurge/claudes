"use client";

/**
 * /admin/tracks — live moving-object lists. One tab per source (satellites via
 * Celestrak/SGP4, aircraft via OpenSky, ships via aisstream). Each tab owns its
 * own fetch + table; the globe overlay (shared `Track` shape) comes later.
 */
import { useState } from "react";
import MuiTab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
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
      {/*
        The hairline baseline is what the selected-tab indicator reads against;
        without it the indicator floats and the row stops looking like tabs.
      */}
      <Tabs
        value={tab}
        onChange={(_, next: Tab) => setTab(next)}
        sx={{ mb: 2, borderBottom: 1, borderColor: "divider" }}
      >
        {TABS.map((t) => (
          <MuiTab key={t.id} value={t.id} label={t.label} />
        ))}
      </Tabs>

      {tab === "satellites" && <SatellitesTable />}
      {tab === "aircraft" && <AircraftTable />}
      {tab === "ships" && <ShipsTable />}
      {tab === "replay" && <ReplayPanel />}
    </AdminPageShell>
  );
}
