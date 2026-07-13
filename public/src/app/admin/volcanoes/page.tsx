"use client";

/**
 * /admin/volcanoes — the active-volcano catalog: worker-cached Smithsonian/USGS
 * Weekly Volcanic Activity Report volcanoes with status + USGS VONA alerts +
 * Wikipedia enrichment + official status timeline, plus manual refresh/enrich
 * triggers alongside the worker's own schedules.
 */
import VolcanoesTable from "../../../components/volcanoes/VolcanoesTable";
import AdminPageShell from "../../../components/admin/AdminPageShell";

export default function VolcanoesPage() {
  return (
    <AdminPageShell
      title="Volcanoes"
      description="Active volcanoes (Smithsonian/USGS weekly report) — status, alerts, timeline and Wikipedia enrichment."
    >
      <VolcanoesTable />
    </AdminPageShell>
  );
}
