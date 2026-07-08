"use client";

/**
 * /admin/cams — the webcam catalog: a list of live cams with status + location,
 * a manual add form, and an inline viewer. The global Windy ingest + a globe/
 * map area-list build on this same catalog later.
 */
import CamsTable from "../../../components/cams/CamsTable";
import AdminPageShell from "../../../components/admin/AdminPageShell";

export default function CamsPage() {
  return (
    <AdminPageShell
      title="Webcams"
      description="Catalogued live cams — status, location and a preview. Add YouTube/HLS streams or still/timelapse URLs."
    >
      <CamsTable />
    </AdminPageShell>
  );
}
