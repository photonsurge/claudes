"use client";

/**
 * /admin/cams — the webcam catalog: a list of live cams with status + location,
 * a manual add form, and an inline viewer. The global Windy ingest + a globe/
 * map area-list build on this same catalog later.
 */
import CamsTable from "../../../components/cams/CamsTable";

export default function CamsPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Webcams</h2>
        <p style={{ color: "#8b95a7", marginTop: 0 }}>
          Catalogued live cams — status, location and a preview. Add YouTube/HLS streams or still/timelapse URLs.
        </p>
        <CamsTable />
      </section>
    </main>
  );
}
