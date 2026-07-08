import AdminPageShell from "../../../components/admin/AdminPageShell";
import CityDetail from "../../../components/cities/CityDetail";

export default async function CityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const cityId = decodeURIComponent(id);
  return (
    <AdminPageShell
      title="City detail"
      description={cityId}
      maxWidth={1150}
      crumbs={[{ href: "/cities", label: "Cities" }, { label: cityId }]}
    >
      <CityDetail id={cityId} />
    </AdminPageShell>
  );
}
