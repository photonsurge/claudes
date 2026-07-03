import CityDetail from "../../../components/cities/CityDetail";

export default async function CityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main style={{ minHeight: "100vh", background: "#0a0e16", color: "#fff", fontFamily: "system-ui, sans-serif" }}>
      <section style={{ maxWidth: 1150, margin: "0 auto", padding: 24 }}>
        <CityDetail id={decodeURIComponent(id)} />
      </section>
    </main>
  );
}
