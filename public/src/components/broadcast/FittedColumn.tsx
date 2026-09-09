"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * A height change smaller than this cannot move the scale enough for a viewer to
 * see it, so it isn't worth a re-render. Sub-pixel reflow noise, a font settling
 * or a 1px border is not a slide changing size.
 */
const RE_FIT_EPSILON_PX = 1.5;

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
    const apply = (h: number) =>
      setHeight((prev) => (Math.abs(prev - h) < RE_FIT_EPSILON_PX ? prev : h));
    // One deliberate read on mount: nothing has measured this column yet.
    apply(element.offsetHeight);
    const observer = new ResizeObserver((entries) => {
      // Take the size the observer ALREADY measured. Reading offsetHeight in
      // here instead forces a synchronous reflow inside the callback — a
      // measure-then-remeasure loop that profiles on the OBS box as paired
      // getBoundingClientRect + Layout stalls, and lands mid-cut as an on-air
      // hitch. The cards above cycle on their own timers (the live alert card
      // sizes to each warning), so this fires through the whole show, not just
      // when a slide changes.
      // Defensive `?.`: a real observer always passes entries, but a stubbed one
      // (jsdom, our own test double) may not, and this must not throw on air.
      const box = entries?.[0]?.borderBoxSize?.[0];
      apply(box ? box.blockSize : element.offsetHeight);
    });
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
