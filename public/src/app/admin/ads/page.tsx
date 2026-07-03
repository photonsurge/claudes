"use client";

import AdsTable from "../../../components/ads/AdsTable";

/**
 * /admin/ads — manage the ad catalog: upload sponsor images (and short video),
 * edit metadata, toggle active/inactive, delete. Broadcast display + scheduling
 * land in a later phase.
 */
export default function AdsPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Ads</h2>
        <p style={{ color: "#8b95a7", marginTop: 0 }}>
          Sponsor creative stored in Mongo. Images now; short video too (large video via GridFS later).
        </p>
        <AdsTable />
      </section>
    </main>
  );
}
