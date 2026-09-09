"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Fit the complete column above the ticker as its report slides change height. */
export default function FittedColumn({ children, top, right, maxHeight }: {
  children: ReactNode;
  top: number;
  right: number;
  maxHeight: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState(0);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const scale = height > 0 ? Math.min(1.16, Math.max(0, maxHeight) / height) : 1;
  return (
    <div ref={ref} style={{
      position: "absolute", top, right, zIndex: 2,
      display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10,
      transform: `scale(${scale})`, transformOrigin: "right top",
      visibility: height > 0 ? "visible" : "hidden",
    }}>
      {children}
    </div>
  );
}
