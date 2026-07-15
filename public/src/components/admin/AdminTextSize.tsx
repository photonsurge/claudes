"use client";

/**
 * Admin-wide text size. Every admin page is laid out in px inline styles, so
 * there's no rem scale to turn up — `zoom` on the page body is what scales the
 * lot (text, padding, controls) while still reflowing to the viewport rather
 * than overflowing it, the way a transform would.
 *
 * The choice is per-browser (localStorage), which is what you want for a
 * "this screen is across the room" setting.
 */
import { useCallback, useEffect, useState } from "react";

const KEY = "admin.textScale";

export const TEXT_SCALES = [
  { label: "S", scale: 0.9, title: "Small text" },
  { label: "M", scale: 1, title: "Normal text" },
  { label: "L", scale: 1.15, title: "Large text" },
  { label: "XL", scale: 1.3, title: "Extra large text" },
] as const;

function read(): number {
  if (typeof window === "undefined") return 1;
  const raw = Number(window.localStorage.getItem(KEY));
  return TEXT_SCALES.some((t) => t.scale === raw) ? raw : 1;
}

/**
 * Reads the saved scale after mount — never during render, so the server and
 * the first client paint agree.
 */
export function useAdminTextScale(): [number, (n: number) => void] {
  const [scale, setScale] = useState(1);

  useEffect(() => {
    setScale(read());
    // Keep other admin tabs in step.
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setScale(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((n: number) => {
    setScale(n);
    window.localStorage.setItem(KEY, String(n));
  }, []);

  return [scale, update];
}

interface AdminTextSizeProps {
  scale: number;
  onScale: (n: number) => void;
}

export default function AdminTextSize({ scale, onScale }: AdminTextSizeProps) {
  return (
    <div
      role="group"
      aria-label="Text size"
      style={{ display: "flex", alignItems: "center", gap: 2, border: "1px solid #242b3d", borderRadius: 6, padding: 2 }}
    >
      {TEXT_SCALES.map((t) => {
        const on = t.scale === scale;
        return (
          <button
            key={t.label}
            type="button"
            onClick={() => onScale(t.scale)}
            title={t.title}
            aria-pressed={on}
            style={{
              padding: "3px 8px",
              borderRadius: 4,
              border: "none",
              background: on ? "#2563eb" : "transparent",
              color: on ? "#fff" : "#8b95a7",
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
