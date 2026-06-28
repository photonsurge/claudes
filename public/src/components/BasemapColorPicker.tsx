"use client";

/**
 * Operator colour controls for the dark (vector) basemap — ocean, land and
 * border. Raster basemaps (satellite/terrain) are baked imagery and ignore
 * these, so the picker is only shown when the dark basemap is active.
 */
import { DEFAULT_BASEMAP_COLORS, type BasemapColors } from "@photonsurge/shared/control";

export interface BasemapColorPickerProps {
  value: BasemapColors | undefined;
  onChange: (colors: BasemapColors) => void;
}

const SWATCHES: { key: keyof BasemapColors; label: string }[] = [
  { key: "ocean", label: "Ocean" },
  { key: "land", label: "Land" },
  { key: "border", label: "Borders" },
];

export default function BasemapColorPicker({ value, onChange }: BasemapColorPickerProps) {
  const colors = value ?? DEFAULT_BASEMAP_COLORS;

  const set = (key: keyof BasemapColors, hex: string) => onChange({ ...colors, [key]: hex });

  return (
    <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
      {SWATCHES.map(({ key, label }) => (
        <label
          key={key}
          style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff", fontSize: 13 }}
        >
          <input
            type="color"
            aria-label={label}
            value={colors[key]}
            onChange={(e) => set(key, e.target.value)}
            style={{
              width: 28,
              height: 28,
              padding: 0,
              border: "1px solid #333",
              borderRadius: 6,
              background: "none",
              cursor: "pointer",
            }}
          />
          {label}
        </label>
      ))}
      <button
        type="button"
        onClick={() => onChange({ ...DEFAULT_BASEMAP_COLORS })}
        style={{
          padding: "4px 10px",
          borderRadius: 6,
          border: "1px solid #333",
          background: "#1a1f2b",
          color: "#8b95a7",
          cursor: "pointer",
          fontSize: 12,
        }}
      >
        Reset
      </button>
    </div>
  );
}
