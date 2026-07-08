"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type Column,
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
} from "@tanstack/react-table";
import type { City } from "../../lib/cities";
import { cityEnrichmentStatus } from "./CityEnrichmentCard";

const muted = "#8b95a7";
const th: React.CSSProperties = { padding: "7px 8px", fontWeight: 600 };
const td: React.CSSProperties = { padding: "7px 8px" };
const ghost: React.CSSProperties = { padding: "3px 8px", borderRadius: 5, border: "1px solid #333", background: "#1a1f2b", color: "#fff", cursor: "pointer", fontSize: 12 };
const danger: React.CSSProperties = { ...ghost, borderColor: "#7f1d1d", color: "#fca5a5" };

function SortHeader({ column, children }: { column: Column<City>; children: React.ReactNode }) {
  const direction = column.getIsSorted();
  return (
    <button type="button" onClick={column.getToggleSortingHandler()} style={{ padding: 0, border: 0, background: "none", color: "inherit", font: "inherit", fontWeight: 600, cursor: "pointer" }}>
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

export default function CitiesTable({
  cities,
  total,
  pageCount,
  loading,
  pagination,
  sorting,
  onPaginationChange,
  onSortingChange,
  onSelect,
  onEdit,
  onDelete,
}: {
  cities: City[];
  total: number;
  pageCount: number;
  loading: boolean;
  pagination: PaginationState;
  sorting: SortingState;
  onPaginationChange: OnChangeFn<PaginationState>;
  onSortingChange: OnChangeFn<SortingState>;
  onSelect: (city: City) => void;
  onEdit: (city: City) => void;
  onDelete: (id: string) => void;
}) {
  const columns = useMemo<ColumnDef<City>[]>(() => [
    {
      accessorKey: "name",
      header: ({ column }) => <SortHeader column={column}>Name</SortHeader>,
      cell: ({ row }) => (
        <div>
          <Link href={`/cities/${encodeURIComponent(row.original.id)}`} style={{ color: "#dbeafe", fontWeight: 600, textDecoration: "none" }}>
            {row.original.isCapital ? "★ " : ""}{row.original.name}
          </Link>
          <button type="button" onClick={() => onSelect(row.original)} aria-label={`Preview ${row.original.name}`} style={{ display: "block", border: 0, padding: 0, marginTop: 2, background: "none", color: muted, cursor: "pointer", fontSize: 10 }}>
            forecast + globe
          </button>
        </div>
      ),
    },
    { accessorKey: "country", header: ({ column }) => <SortHeader column={column}>Country</SortHeader>, cell: ({ getValue }) => String(getValue() ?? "") },
    { accessorKey: "lat", header: ({ column }) => <SortHeader column={column}>Lat</SortHeader>, cell: ({ getValue }) => Number(getValue()).toFixed(2) },
    { accessorKey: "lng", header: ({ column }) => <SortHeader column={column}>Lng</SortHeader>, cell: ({ getValue }) => Number(getValue()).toFixed(2) },
    { accessorKey: "population", header: ({ column }) => <SortHeader column={column}>Population</SortHeader>, cell: ({ getValue }) => Number(getValue() ?? 0).toLocaleString() },
    { accessorKey: "isCapital", header: ({ column }) => <SortHeader column={column}>Capital</SortHeader>, cell: ({ getValue }) => getValue() ? "Yes" : "" },
    {
      accessorKey: "wikiFetchedAt",
      header: ({ column }) => <SortHeader column={column}>Enrichment</SortHeader>,
      cell: ({ row }) => {
        const status = cityEnrichmentStatus(row.original);
        return <span style={{ color: status.color, whiteSpace: "nowrap" }}>● {status.label}</span>;
      },
    },
    {
      id: "actions",
      enableSorting: false,
      header: "",
      cell: ({ row }) => (
        <div style={{ display: "flex", gap: 5 }}>
          <Link href={`/cities/${encodeURIComponent(row.original.id)}`} style={{ ...ghost, textDecoration: "none" }}>View</Link>
          <button type="button" onClick={() => onEdit(row.original)} style={ghost}>Edit</button>
          <button type="button" onClick={() => onDelete(row.original.id)} style={danger}>Delete</button>
        </div>
      ),
    },
  ], [onDelete, onEdit, onSelect]);

  const table = useReactTable({
    data: cities,
    columns,
    getCoreRowModel: getCoreRowModel(),
    manualPagination: true,
    manualSorting: true,
    pageCount,
    rowCount: total,
    enableMultiSort: false,
    state: { pagination, sorting },
    onPaginationChange,
    onSortingChange,
  });
  const currentPage = pagination.pageIndex + 1;
  const numeric = new Set(["lat", "lng", "population"]);

  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ overflowX: "auto", border: "1px solid #1b2030", borderRadius: 8, opacity: loading && cities.length ? 0.65 : 1 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id} style={{ textAlign: "left", color: muted }}>
                {group.headers.map((header) => (
                  <th key={header.id} style={{ ...th, textAlign: numeric.has(header.column.id) ? "right" : "left" }}>
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
                  <td key={cell.id} style={{ ...td, textAlign: numeric.has(cell.column.id) ? "right" : "left" }}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {cities.length === 0 && (
              <tr><td colSpan={columns.length} style={{ ...td, padding: 18, color: muted }}>{loading ? "Loading cities…" : "No cities match this search."}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label="City table pages" style={{ display: "flex", alignItems: "center", gap: 5, flexWrap: "wrap", marginTop: 10 }}>
        <button type="button" onClick={() => table.firstPage()} disabled={!table.getCanPreviousPage()} style={ghost} aria-label="First city page">«</button>
        <button type="button" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} style={ghost} aria-label="Previous city page">‹</button>
        {paginationItems(currentPage, pageCount).map((item, index) => item === "ellipsis" ? (
          <span key={`ellipsis-${index}`} style={{ color: muted, padding: "0 3px" }}>…</span>
        ) : (
          <button
            key={item}
            type="button"
            onClick={() => table.setPageIndex(item - 1)}
            aria-label={`City page ${item}`}
            aria-current={item === currentPage ? "page" : undefined}
            style={{ ...ghost, background: item === currentPage ? "#2563eb" : ghost.background, padding: "5px 9px" }}
          >
            {item}
          </button>
        ))}
        <button type="button" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} style={ghost} aria-label="Next city page">›</button>
        <button type="button" onClick={() => table.lastPage()} disabled={!table.getCanNextPage()} style={ghost} aria-label="Last city page">»</button>
        <span style={{ color: muted, fontSize: 12, marginLeft: 5 }}>Page {pageCount ? currentPage : 0} of {pageCount}</span>
        <label style={{ color: muted, fontSize: 12, marginLeft: "auto" }}>
          Rows&nbsp;
          <select value={pagination.pageSize} onChange={(event) => table.setPageSize(Number(event.target.value))} aria-label="City rows per page" style={{ background: "#1a1f2b", color: "#fff", border: "1px solid #333", borderRadius: 5, padding: "4px 6px" }}>
            {[10, 25, 50, 100].map((size) => <option key={size} value={size}>{size}</option>)}
          </select>
        </label>
      </nav>
    </div>
  );
}
