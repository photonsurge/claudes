"use client";

/**
 * /admin/regions — oceans/continents/EU blocs/UK nations: Wikipedia
 * enrichment and the latest bbox-averaged area-weather snapshot, plus manual
 * reseed/enrich/weather-refresh triggers.
 */
import RegionsTable from "../../../components/regions/RegionsTable";

export default function RegionsPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Regions</h2>
        <p style={{ color: "#8b95a7", marginTop: 0 }}>
          Oceans, continents, EU blocs and UK nations — Wikipedia enrichment and the latest area-weather snapshot.
        </p>
        <RegionsTable />
      </section>
    </main>
  );
}
