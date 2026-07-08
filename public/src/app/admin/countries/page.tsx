"use client";

/**
 * /admin/countries — the ~240-country catalog: Natural Earth boundary data,
 * Wikipedia/Wikidata enrichment, and the latest polygon-masked area-weather
 * snapshot, plus manual reseed/enrich/weather-refresh triggers.
 */
import CountriesTable from "../../../components/countries/CountriesTable";

export default function CountriesPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <h2 style={{ marginTop: 0 }}>Countries</h2>
        <p style={{ color: "#8b95a7", marginTop: 0 }}>
          Full country catalog — continent/subregion, Wikipedia enrichment, and the latest area-weather snapshot.
        </p>
        <CountriesTable />
      </section>
    </main>
  );
}
