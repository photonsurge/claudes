import VehicleDetail from "../../../../components/vehicles/VehicleDetail";

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1100, margin: "0 auto", padding: 24 }}>
        <VehicleDetail id={decodeURIComponent(id)} />
      </section>
    </main>
  );
}
