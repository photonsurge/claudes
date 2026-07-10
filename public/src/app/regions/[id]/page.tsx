import AdminPageShell from "../../../components/admin/AdminPageShell";
import RegionDetail from "../../../components/regions/RegionDetail";

export default async function RegionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const regionId = decodeURIComponent(id);
  return (
    <AdminPageShell
      title="Region detail"
      description={regionId}
      maxWidth={1150}
      crumbs={[{ href: "/regions", label: "Regions" }, { label: regionId }]}
    >
      <RegionDetail id={regionId} />
    </AdminPageShell>
  );
}
