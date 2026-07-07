"use client";

/**
 * /admin/volcanoes — the active-volcano catalog: worker-cached NASA EONET
 * events with status + Wikipedia enrichment, plus manual refresh/enrich
 * triggers alongside the worker's own schedules.
 */
import VolcanoesTable from "../../../components/volcanoes/VolcanoesTable";

export default function VolcanoesPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Volcanoes</h2>
        <p style={{ color: "#8b95a7", marginTop: 0 }}>
          Active volcanoes (NASA EONET) — status, last report and Wikipedia enrichment.
        </p>
        <VolcanoesTable />
      </section>
    </main>
  );
}
