export type VehicleKind = "aircraft" | "ship";

export interface VehicleRecord {
  id: string;
  kind: VehicleKind;
  code: string;
  name?: string;
  country?: string;
  flag?: string;
  registration?: string;
  imo?: string;
  firstSeen?: string;
  lastSeen?: string;
  timesSeen?: number;
  lastLng?: number;
  lastLat?: number;
  type?: string;
  operator?: string;
  manufacturer?: string;
  photoUrl?: string;
  photoCredit?: string;
  photoLink?: string;
  wikiTitle?: string;
  wikiExtract?: string;
  wikiFetchedAt?: number;
  photoFetchedAt?: number;
  notable?: boolean;
  vip?: boolean;
  enabled?: boolean;
  category?: string;
  label?: string;
  notes?: string;
  photoUrlOverride?: string;
  blurbOverride?: string;
  pathPoints?: number;
  path?: { lng: number; lat: number; t: number }[];
  created?: string;
  updated?: string;
  aircraftMeta?: {
    registration?: string;
    type?: string;
    typeCode?: string;
    manufacturer?: string;
    operator?: string;
    fetchedAt: number;
    notFound?: boolean;
  };
}

export interface VehicleListOptions {
  kind?: VehicleKind;
  notable?: boolean;
  q?: string;
  pageIndex?: number;
  pageSize?: number;
  sortBy?: VehicleSortField;
  sortDirection?: "asc" | "desc";
}

export type VehicleSortField = "name" | "kind" | "code" | "country" | "timesSeen" | "firstSeen" | "lastSeen" | "updated";

export interface VehiclesResponse {
  count: number;
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
  vehicles: VehicleRecord[];
  error?: string;
}

export async function listVehicles(opts: VehicleListOptions = {}): Promise<VehiclesResponse> {
  const params = new URLSearchParams();
  if (opts.kind) params.set("kind", opts.kind);
  if (opts.notable) params.set("notable", "1");
  if (opts.q) params.set("q", opts.q);
  if (opts.pageIndex != null) params.set("page", String(opts.pageIndex + 1));
  if (opts.pageSize) params.set("pageSize", String(opts.pageSize));
  if (opts.sortBy) params.set("sort", opts.sortBy);
  if (opts.sortDirection) params.set("direction", opts.sortDirection);
  try {
    const res = await fetch(`/api/vehicles?${params.toString()}`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body) {
      return { count: 0, total: 0, page: 1, pageSize: opts.pageSize ?? 25, pageCount: 0, vehicles: [], error: body?.error ?? `HTTP ${res.status}` };
    }
    return body as VehiclesResponse;
  } catch (error) {
    return { count: 0, total: 0, page: 1, pageSize: opts.pageSize ?? 25, pageCount: 0, vehicles: [], error: String(error) };
  }
}

export async function getVehicle(id: string): Promise<{ vehicle?: VehicleRecord; error?: string }> {
  try {
    const res = await fetch(`/api/vehicles/${encodeURIComponent(id)}?path=0`, { cache: "no-store" });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.vehicle) return { error: body?.error ?? `HTTP ${res.status}` };
    return { vehicle: body.vehicle as VehicleRecord };
  } catch (error) {
    return { error: String(error) };
  }
}

/** Flag/re-save a vehicle as notable and queue its targeted enrichment job. */
export async function queueVehicleEnrichment(vehicle: VehicleRecord): Promise<{ vehicle?: VehicleRecord; error?: string }> {
  try {
    const res = await fetch("/api/admin/notable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: vehicle.kind,
        code: vehicle.code,
        label: vehicle.label || vehicle.name,
        wikiTitle: vehicle.wikiTitle,
        category: vehicle.category,
        vip: vehicle.vip,
      }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.notable) return { error: body?.error ?? `HTTP ${res.status}` };
    return { vehicle: body.notable as VehicleRecord };
  } catch (error) {
    return { error: String(error) };
  }
}
