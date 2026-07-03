"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import {
  listVehicles,
  type VehicleKind,
  type VehicleRecord,
  type VehicleSortField,
} from "../../lib/vehicles/client";
import { asOf, primary, select, td, tdNum, th, thNum } from "../tracks/styles";

const muted = "#8b95a7";
const panel = { border: "1px solid #1b2030", borderRadius: 8, background: "#0c111c" } as const;

function displayName(vehicle: VehicleRecord): string {
  return vehicle.label?.trim() || vehicle.wikiTitle?.trim() || vehicle.name?.trim() || vehicle.code.toUpperCase();
}

function formatDate(value?: string | number): string {
  if (value == null) return "Never";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function enrichmentState(vehicle: VehicleRecord): { label: string; color: string } {
  const meta = vehicle.aircraftMeta;
  const hasMedia = Boolean(vehicle.wikiExtract || vehicle.photoUrl);
  const hasMetadata = Boolean(
    vehicle.type || vehicle.operator || vehicle.manufacturer || meta?.type || meta?.operator || meta?.manufacturer,
  );
  if (hasMedia && hasMetadata) return { label: "Media + metadata", color: "#34d399" };
  if (hasMedia) return { label: "Media", color: "#34d399" };
  if (hasMetadata) return { label: "Metadata", color: "#67e8f9" };
  if (vehicle.wikiFetchedAt || vehicle.photoFetchedAt || meta?.notFound) {
    return { label: "Checked — no match", color: "#fbbf24" };
  }
  return { label: "Not run", color: muted };
}

function SortHeader({ column, children }: { column: Column<VehicleRecord>; children: React.ReactNode }) {
  const direction = column.getIsSorted();
  if (!column.getCanSort()) return <>{children}</>;
  return (
    <button
      type="button"
      onClick={column.getToggleSortingHandler()}
      style={{ padding: 0, border: 0, background: "none", color: "inherit", font: "inherit", fontWeight: 600, cursor: "pointer" }}
      title="Sort this column"
    >
      {children} <span aria-hidden="true">{direction === "asc" ? "↑" : direction === "desc" ? "↓" : "↕"}</span>
    </button>
  );
}

function paginationItems(current: number, pageCount: number): Array<number | "ellipsis"> {
  const pages = new Set([1, pageCount, current - 1, current, current + 1]);
  const valid = [...pages].filter((page) => page >= 1 && page <= pageCount).sort((a, b) => a - b);
  const result: Array<number | "ellipsis"> = [];
  valid.forEach((page, index) => {
    if (index > 0 && page - valid[index - 1] > 1) result.push("ellipsis");
    result.push(page);
  });
  return result;
}

export default function VehiclesTable() {
  const [rows, setRows] = useState<VehicleRecord[]>([]);
  const [kind, setKind] = useState<"" | VehicleKind>("");
  const [notableOnly, setNotableOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [pagination, setPagination] = useState<PaginationState>({ pageIndex: 0, pageSize: 25 });
  const [sorting, setSorting] = useState<SortingState>([{ id: "lastSeen", desc: true }]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const columns = useMemo<ColumnDef<VehicleRecord>[]>(() => [
    {
      id: "name",
      accessorFn: displayName,
      header: ({ column }) => <SortHeader column={column}>Vehicle</SortHeader>,
      cell: ({ row }) => {
        const vehicle = row.original;
        return (
          <div>
            <Link href={`/admin/vehicles/${encodeURIComponent(vehicle.id)}`} style={{ color: "#dbeafe", fontWeight: 600, textDecoration: "none" }}>
              {displayName(vehicle)}
            </Link>
            <div style={{ color: muted, fontSize: 11 }}>
              {vehicle.name && vehicle.name !== displayName(vehicle)
                ? vehicle.name
                : vehicle.registration || vehicle.aircraftMeta?.registration || vehicle.imo || ""}
            </div>
          </div>
        );
      },
    },
    {
      accessorKey: "kind",
      header: ({ column }) => <SortHeader column={column}>Kind</SortHeader>,
      cell: ({ getValue }) => <span style={{ color: muted }}>{String(getValue())}</span>,
    },
    {
      accessorKey: "code",
      header: ({ column }) => <SortHeader column={column}>Code</SortHeader>,
      cell: ({ getValue }) => <span style={{ fontFamily: "ui-monospace, monospace" }}>{String(getValue())}</span>,
    },
    {
      accessorKey: "country",
      header: ({ column }) => <SortHeader column={column}>Country</SortHeader>,
      cell: ({ row }) => [row.original.flag, row.original.country].filter(Boolean).join(" ") || "—",
    },
    {
      id: "enrichment",
      enableSorting: false,
      header: "Enrichment",
      cell: ({ row }) => {
        const state = enrichmentState(row.original);
        return <span style={{ color: state.color }}>● {state.label}</span>;
      },
    },
    {
      accessorKey: "timesSeen",
      header: ({ column }) => <SortHeader column={column}>Seen</SortHeader>,
      cell: ({ getValue }) => <div style={{ textAlign: "right" }}>{Number(getValue() ?? 0).toLocaleString()}</div>,
      meta: { numeric: true },
    },
    {
      accessorKey: "lastSeen",
      header: ({ column }) => <SortHeader column={column}>Last seen</SortHeader>,
      cell: ({ getValue }) => <span style={{ whiteSpace: "nowrap", color: muted }}>{formatDate(getValue() as string | undefined)}</span>,
    },
    {
      id: "view",
      enableSorting: false,
      header: "",
      cell: ({ row }) => (
        <Link href={`/admin/vehicles/${encodeURIComponent(row.original.id)}`} style={{ color: "#60a5fa", textDecoration: "none", whiteSpace: "nowrap" }}>
          View →
        </Link>
      ),
    },
  ], []);

  const sort = sorting[0] ?? { id: "lastSeen", desc: true };
  const reload = useCallback(async () => {
    const activeRequest = ++requestId.current;
    setLoading(true);
    setError(null);
    const result = await listVehicles({
      kind: kind || undefined,
      notable: notableOnly || undefined,
      q: query || undefined,
      pageIndex: pagination.pageIndex,
      pageSize: pagination.pageSize,
      sortBy: sort.id as VehicleSortField,
      sortDirection: sort.desc ? "desc" : "asc",
    });
    if (activeRequest !== requestId.current) return;
    setRows(result.vehicles);
    setTotal(result.total);
    setPageCount(result.pageCount);
    if (result.error) setError(result.error);
    setLoading(false);
  }, [kind, notableOnly, pagination.pageIndex, pagination.pageSize, query, sort.desc, sort.id]);

  useEffect(() => { reload(); }, [reload]);

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount,
    rowCount: total,
    enableMultiSort: false,
    state: { pagination, sorting },
    onPaginationChange: setPagination,
    onSortingChange: (updater) => {
      setSorting((current) => typeof updater === "function" ? updater(current) : updater);
      setPagination((current) => ({ ...current, pageIndex: 0 }));
    },
  });

  const resetToFirstPage = () => setPagination((current) => ({ ...current, pageIndex: 0 }));
  const currentPage = pagination.pageIndex + 1;

  return (
    <div>
      <form
        onSubmit={(event) => { event.preventDefault(); setQuery(search.trim()); resetToFirstPage(); }}
        style={{ ...panel, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: 12, marginBottom: 12 }}
      >
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name, label or code" aria-label="Search vehicles" style={{ ...select, padding: "7px 9px", minWidth: 230 }} />
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          Kind
          <select
            value={kind}
            onChange={(event) => { setKind(event.target.value as "" | VehicleKind); resetToFirstPage(); }}
            style={{ ...select, padding: "7px 9px" }}
          >
            <option value="">All</option>
            <option value="aircraft">Aircraft</option>
            <option value="ship">Ships</option>
          </select>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
          <input
            type="checkbox"
            checked={notableOnly}
            onChange={(event) => { setNotableOnly(event.target.checked); resetToFirstPage(); }}
          />
          Notable only
        </label>
        <button type="submit" style={primary}>Search</button>
        <button type="button" onClick={reload} disabled={loading} style={{ ...primary, background: "#1a1f2b" }}>{loading ? "…" : "Refresh"}</button>
        <span style={{ marginLeft: "auto", color: muted, fontSize: 12 }}>{total.toLocaleString()} vehicles</span>
      </form>

      {error && <div role="alert" style={{ ...asOf, color: "#fca5a5", marginBottom: 8 }}>{error}</div>}

      <div style={{ ...panel, overflowX: "auto", opacity: loading && rows.length ? 0.65 : 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id} style={{ textAlign: "left", color: muted }}>
                {headerGroup.headers.map((header) => (
                  <th key={header.id} style={header.column.columnDef.meta && "numeric" in header.column.columnDef.meta ? thNum : th}>
                    {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} style={{ borderTop: "1px solid #1b2030" }}>
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} style={cell.column.columnDef.meta && "numeric" in cell.column.columnDef.meta ? tdNum : td}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={columns.length} style={{ ...td, padding: 18, color: muted }}>{loading ? "Loading vehicles…" : "No vehicles match these filters."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label="Vehicle table pages" style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginTop: 12 }}>
        <button type="button" onClick={() => table.firstPage()} disabled={!table.getCanPreviousPage()} style={{ ...primary, background: "#1a1f2b", padding: "6px 9px" }} aria-label="First page">«</button>
        <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} style={{ ...primary, background: "#1a1f2b", padding: "6px 9px" }} aria-label="Previous page">‹</button>
        {paginationItems(currentPage, pageCount).map((item, index) => item === "ellipsis" ? (
          <span key={`ellipsis-${index}`} style={{ color: muted, padding: "0 3px" }}>…</span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => table.setPageIndex(item - 1)}
            aria-label={`Page ${item}`}
            aria-current={item === currentPage ? "page" : undefined}
            style={{ ...primary, background: item === currentPage ? "#2563eb" : "#1a1f2b", padding: "6px 10px" }}
          >
            {item}
          </button>
        ))}
        <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} style={{ ...primary, background: "#1a1f2b", padding: "6px 9px" }} aria-label="Next page">›</button>
        <button type="button" onClick={() => table.lastPage()} disabled={!table.getCanNextPage()} style={{ ...primary, background: "#1a1f2b", padding: "6px 9px" }} aria-label="Last page">»</button>
        <span style={{ color: muted, fontSize: 12, marginLeft: 6 }}>Page {pageCount ? currentPage : 0} of {pageCount}</span>
        <label style={{ color: muted, fontSize: 12, marginLeft: "auto" }}>
          Rows&nbsp;
          <select
            value={pagination.pageSize}
            onChange={(event) => table.setPageSize(Number(event.target.value))}
            style={select}
            aria-label="Rows per page"
          >
            {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </nav>
    </div>
  );
}
