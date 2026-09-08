"use client";

import { useRef } from "react";

/**
 * Keep the previous value while a new one is structurally identical (by JSON),
 * so small derived arrays/objects — a `[lng, lat]`, a bbox, an up-next list —
 * built fresh on every render keep a stable identity for `React.memo` children
 * and effect deps. Meant for SMALL values: it stringifies on each render.
 */
export function useStableJson<T>(value: T): T {
  const ref = useRef<{ key: string; value: T } | null>(null);
  const key = JSON.stringify(value) ?? "";
  if (!ref.current || ref.current.key !== key) ref.current = { key, value };
  return ref.current.value;
}
