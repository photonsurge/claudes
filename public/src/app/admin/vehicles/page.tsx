import AdminPageShell from "../../../components/admin/AdminPageShell";
import VehiclesTable from "../../../components/vehicles/VehiclesTable";

export default function VehiclesPage() {
  return (
    <AdminPageShell
      title="Vehicles in DB"
      description="Durable aircraft and ship records seen by the workers. Open a record to inspect its identity and enrichment results."
      maxWidth={1400}
    >
      <VehiclesTable />
    </AdminPageShell>
  );
}
