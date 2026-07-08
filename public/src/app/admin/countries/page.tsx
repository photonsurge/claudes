"use client";

/**
 * /admin/countries — the ~240-country catalog: Natural Earth boundary data,
 * Wikipedia/Wikidata enrichment, and the latest polygon-masked area-weather
 * snapshot, plus manual reseed/enrich/weather-refresh triggers.
 */
import CountriesTable from "../../../components/countries/CountriesTable";
import AdminPageShell from "../../../components/admin/AdminPageShell";

export default function CountriesPage() {
  return (
    <AdminPageShell
      title="Countries"
      description="Full country catalog — continent/subregion, Wikipedia enrichment, and the latest area-weather snapshot."
    >
      <CountriesTable />
    </AdminPageShell>
  );
}
