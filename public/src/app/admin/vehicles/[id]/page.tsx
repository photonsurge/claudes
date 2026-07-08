import AdminPageShell from "../../../../components/admin/AdminPageShell";
import VehicleDetail from "../../../../components/vehicles/VehicleDetail";

export default async function VehiclePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const vehicleId = decodeURIComponent(id);
  return (
    <AdminPageShell
      title="Vehicle detail"
      description={vehicleId}
      crumbs={[{ href: "/admin/vehicles", label: "Vehicles" }, { label: vehicleId }]}
    >
      <VehicleDetail id={vehicleId} />
    </AdminPageShell>
  );
}
