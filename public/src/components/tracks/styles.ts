import type { CSSProperties } from "react";

/** Shared table/toolbar styles for the /admin/tracks source tables. */
export const primary: CSSProperties = {
  padding: "8px 14px",
  borderRadius: 6,
  border: "1px solid #333",
  background: "#2563eb",
  color: "#fff",
  cursor: "pointer",
};
export const select: CSSProperties = {
  background: "#1a1f2b",
  color: "#fff",
  border: "1px solid #333",
  borderRadius: 5,
  padding: "4px 6px",
};
export const toolbar: CSSProperties = {
  display: "flex",
  gap: 12,
  alignItems: "center",
  flexWrap: "wrap",
  justifyContent: "flex-end",
};
export const asOf: CSSProperties = { color: "#8b95a7", fontSize: 12, marginTop: 6 };
export const th: CSSProperties = { padding: "6px 8px", fontWeight: 600 };
export const thNum: CSSProperties = { ...th, textAlign: "right" };
export const td: CSSProperties = { padding: "6px 8px" };
export const tdNum: CSSProperties = {
  ...td,
  textAlign: "right",
  fontVariantNumeric: "tabular-nums",
};
