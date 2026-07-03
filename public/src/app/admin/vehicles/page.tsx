import VehiclesTable from "../../../components/vehicles/VehiclesTable";

export default function VehiclesPage() {
  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1400, margin: "0 auto", padding: 24 }}>
        <h2 style={{ marginTop: 0, marginBottom: 6 }}>Vehicles in DB</h2>
        <p style={{ color: "#8b95a7", marginTop: 0 }}>
          Durable aircraft and ship records seen by the workers. Open a record to inspect its identity and enrichment results.
        </p>
        <VehiclesTable />
      </section>
    </main>
  );
}
