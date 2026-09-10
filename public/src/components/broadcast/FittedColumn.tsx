"use client";

import type { ReactNode } from "react";

/**
 * The top-right column: the live alert (header) above the WORLD REPORT deck,
 * clipped at the ticker. It never scales and never auto-scrolls — a walking
 * column read as the whole card drifting on air — so each deck slide is sized
 * to fit above the ticker on its own (see HazardScreen / WorldSituationPanel).
 */
export default function FittedColumn({ children, header, top, right, maxHeight }: {
  children: ReactNode;
  header?: ReactNode;
  top: number;
  right: number;
  maxHeight: number;
}) {
  return (
    <div style={{
      position: "absolute", top, right, zIndex: 2,
      display: "flex", flexDirection: "column", alignItems: "stretch", gap: 10,
      width: 400, maxHeight: Math.max(0, maxHeight), overflow: "hidden",
    }}>
      {header}
      <div style={{ minHeight: 0, flex: "0 1 auto", overflow: "hidden" }}>
        {children}
      </div>
    </div>
  );
}
