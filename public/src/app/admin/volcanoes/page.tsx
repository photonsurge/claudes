"use client";

/**
 * /admin/volcanoes — the active-volcano catalog: worker-cached NASA EONET
 * events with status + Wikipedia enrichment, plus manual refresh/enrich
 * triggers alongside the worker's own schedules.
 */
import VolcanoesTable from "../../../components/volcanoes/VolcanoesTable";
import AdminPageShell from "../../../components/admin/AdminPageShell";

export default function VolcanoesPage() {
  return (
    <AdminPageShell
      title="Volcanoes"
      description="Active volcanoes (NASA EONET) — status, last report and Wikipedia enrichment."
    >
      <VolcanoesTable />
    </AdminPageShell>
  );
}
