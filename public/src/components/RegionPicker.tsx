"use client";

/**
 * Grouped camera-framing picker: a curated Favorites strip, then a labelled
 * section of chips per region group (Oceans / Continents / Key countries /
 * Europe / UK), then an "All countries" dropdown over the full baked list.
 * Every choice frames the camera via onFitBounds(bbox).
 */
import {
  REGION_GROUPS,
  regionsInGroup,
  favoriteRegions,
  type iRegionPreset,
} from "@photonsurge/shared/regions";
import { COUNTRY_BBOXES, getCountry } from "@photonsurge/shared/countries";

export interface RegionPickerProps {
  onFitBounds: (bbox: [number, number, number, number]) => void;
}

export default function RegionPicker({ onFitBounds }: RegionPickerProps) {
  const chip = (r: iRegionPreset) => (
    <button key={r.id} type="button" onClick={() => onFitBounds(r.bbox)} style={chipStyle}>
      {r.label}
    </button>
  );

  const favorites = favoriteRegions();

  return (
    <div style={{ marginTop: 6 }}>
      {favorites.length > 0 && (
        <Section label="★ Favorites">{favorites.map(chip)}</Section>
      )}

      {REGION_GROUPS.map((g) => (
        <Section key={g.id} label={g.label}>
          {regionsInGroup(g.id).map(chip)}
        </Section>
      ))}

      <div style={{ marginTop: 8 }}>
        <select
          aria-label="all countries"
          value=""
          onChange={(e) => {
            const c = getCountry(e.target.value);
            if (c) onFitBounds(c.bbox);
          }}
          style={selectStyle}
        >
          <option value="">All countries…</option>
          {COUNTRY_BBOXES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 6 }}>
      <div role="heading" aria-level={3} style={labelStyle}>
        {label}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>{children}</div>
    </div>
  );
}

const labelStyle: React.CSSProperties = {
  fontSize: 10,
  textTransform: "uppercase",
  letterSpacing: 0.5,
  color: "#8a93a6",
  marginBottom: 3,
};
const chipStyle: React.CSSProperties = {
  padding: "3px 8px",
  fontSize: 11,
  borderRadius: 5,
  border: "1px solid #333",
  background: "#1a1f2b",
  color: "#fff",
  cursor: "pointer",
};
const selectStyle: React.CSSProperties = {
  width: "100%",
  padding: "5px 8px",
  fontSize: 12,
  borderRadius: 6,
  border: "1px solid #333",
  background: "#0f131c",
  color: "#fff",
};
