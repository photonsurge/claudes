"use client";

/**
 * /admin/volcanoes — the active-volcano catalog: worker-cached Smithsonian/USGS
 * Weekly Volcanic Activity Report volcanoes with status + USGS VONA alerts +
 * Wikipedia enrichment + official status timeline, plus manual refresh/enrich
 * triggers alongside the worker's own schedules.
 */
import VolcanoesTable from "../../../components/volcanoes/VolcanoesTable";
import VolcanoMediaSources from "../../../components/volcanoes/VolcanoMediaSources";
import AdminPageShell from "../../../components/admin/AdminPageShell";

export default function VolcanoesPage() {
  return (
    <AdminPageShell
      title="Volcanoes"
      description="The full Smithsonian GVP volcano catalog — status, alerts, eruption history, timeline and enrichment. Only a few dozen are erupting or in unrest at any time; the rest are dormant and kept for their stats."
    >
      <VolcanoMediaSources />
      <VolcanoesTable />
    </AdminPageShell>
  );
}
