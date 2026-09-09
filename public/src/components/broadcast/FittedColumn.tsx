"use client";

import type { ReactNode } from "react";
import AutoScroll from "./AutoScroll";

/** Keep alerts visible and scroll overflowing reports at their normal text size. */
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
      <AutoScroll speed={22} pause={3000} style={{ minHeight: 0, flex: "0 1 auto" }}>
        {children}
      </AutoScroll>
    </div>
  );
}
