"use client";

/**
 * /admin/sea-points — the ocean-monitoring-point catalog: currents/features
 * plus real depth-monitoring regions (Niño boxes, Atlantic MDR, North Sea,
 * Med, Indian Ocean Dipole) the `ocean` Director kind rotates through.
 * Manually managed (no upstream feed) — add/retire/toggle here, no code
 * change needed.
 */
import SeaPointsTable from "../../../components/sea-points/SeaPointsTable";

export default function SeaPointsPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Sea points</h2>
        <p style={{ color: "#8b95a7", marginTop: 0 }}>
          Ocean-monitoring points the &quot;ocean&quot; Director kind rotates through — currents/features and
          depth-monitoring regions. Disabled points are skipped, not deleted.
        </p>
        <SeaPointsTable />
      </section>
    </main>
  );
}
