"use client";

/**
 * /admin/sea-points — the ocean-monitoring-point catalog: currents/features
 * plus real depth-monitoring regions (Niño boxes, Atlantic MDR, North Sea,
 * Med, Indian Ocean Dipole) the `ocean` Director kind rotates through.
 * Manually managed (no upstream feed) — add/retire/toggle here, no code
 * change needed.
 */
import SeaPointsTable from "../../../components/sea-points/SeaPointsTable";
import AdminPageShell from "../../../components/admin/AdminPageShell";

export default function SeaPointsPage() {
  return (
    <AdminPageShell
      title="Sea points"
      description={
        <>
          Ocean-monitoring points the &quot;ocean&quot; Director kind rotates through — currents/features and
          depth-monitoring regions. Disabled points are skipped, not deleted.
        </>
      }
    >
      <SeaPointsTable />
    </AdminPageShell>
  );
}
