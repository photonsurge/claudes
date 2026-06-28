"use client";

/** Switches the basemap underneath the weather layers. */
import { BASEMAPS } from "@photonsurge/shared/basemaps";

export interface BasemapPickerProps {
  value: string;
  onChange: (basemapId: string) => void;
}

export default function BasemapPicker({ value, onChange }: BasemapPickerProps) {
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {BASEMAPS.map((b) => (
        <button
          key={b.id}
          type="button"
          onClick={() => onChange(b.id)}
          aria-pressed={value === b.id}
          style={{
            padding: "6px 10px",
            borderRadius: 6,
            border: "1px solid #333",
            background: value === b.id ? "#2563eb" : "#1a1f2b",
            color: "#fff",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          {b.label}
        </button>
      ))}
    </div>
  );
}
