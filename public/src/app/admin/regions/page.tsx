"use client";

/**
 * /admin/regions — oceans/continents/EU blocs/UK nations: Wikipedia
 * enrichment and the latest bbox-averaged area-weather snapshot, plus manual
 * reseed/enrich/weather-refresh triggers.
 */
import RegionsTable from "../../../components/regions/RegionsTable";
import AdminPageShell from "../../../components/admin/AdminPageShell";

export default function RegionsPage() {
  return (
    <AdminPageShell
      title="Regions"
      description="Oceans, continents, EU blocs and UK nations — Wikipedia enrichment and the latest area-weather snapshot."
    >
      <RegionsTable />
    </AdminPageShell>
  );
}
