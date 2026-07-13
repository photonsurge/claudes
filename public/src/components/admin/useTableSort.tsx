"use client";

import { useMemo, useState } from "react";

type SortValue = string | number | boolean | Date | null | undefined;
const comparable = (value: SortValue): string | number => value instanceof Date ? value.getTime()
  : typeof value === "boolean" ? Number(value) : typeof value === "number" ? value : String(value ?? "").toLocaleLowerCase();

export function useTableSort<T, A extends Record<string, (row: T) => SortValue>>(rows: T[], accessors: A,
  defaultKey: Extract<keyof A, string>, defaultDesc = false) {
  type K = Extract<keyof A, string>;
  const [key, setKey] = useState<K>(defaultKey); const [desc, setDesc] = useState(defaultDesc);
  const sorted = useMemo(() => [...rows].sort((a, b) => { const av = comparable(accessors[key](a)); const bv = comparable(accessors[key](b));
    const result = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), undefined, { numeric: true }); return desc ? -result : result;
  }), [accessors, desc, key, rows]);
  const header = (column: K, label: string) => <button type="button" onClick={() => { if (column === key) setDesc((v) => !v); else { setKey(column); setDesc(false); } }}
    style={{ appearance: "none", border: 0, padding: 0, background: "transparent", color: "inherit", font: "inherit", fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
    {label} {key === column ? (desc ? "↓" : "↑") : "↕"}
  </button>;
  return { rows: sorted, header };
}
