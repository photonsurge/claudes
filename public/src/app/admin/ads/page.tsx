"use client";

import AdsTable from "../../../components/ads/AdsTable";
import AdminPageShell from "../../../components/admin/AdminPageShell";

/**
 * /admin/ads — manage the ad catalog: upload sponsor images (and short video),
 * edit metadata, toggle active/inactive, delete. Broadcast display + scheduling
 * land in a later phase.
 */
export default function AdsPage() {
  return (
    <AdminPageShell
      title="Ads"
      description="Sponsor creative stored in Mongo. Images now; short video too (large video via GridFS later)."
    >
      <AdsTable />
    </AdminPageShell>
  );
}
