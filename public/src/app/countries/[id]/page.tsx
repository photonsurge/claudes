import AdminPageShell from "../../../components/admin/AdminPageShell";
import CountryDetail from "../../../components/countries/CountryDetail";

export default async function CountryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const countryId = decodeURIComponent(id);
  return (
    <AdminPageShell
      title="Country detail"
      description={countryId}
      maxWidth={1150}
      crumbs={[{ href: "/countries", label: "Countries" }, { label: countryId }]}
    >
      <CountryDetail id={countryId} />
    </AdminPageShell>
  );
}
