"use client";

/**
 * Per-hazard-type toggles for the alert overlay. One chip per hazard category
 * (heat, flood, wind …) — lit = shown on the globe, dimmed = hidden. State is
 * the OFF-list (ControlState.alertHazardsOff), so "everything on" is the empty
 * default and newly added hazard types show up enabled.
 */
import { HAZARDS, type HazardType } from "@photonsurge/shared/alerts/hazard";

interface Props {
  hazardsOff: HazardType[];
  onChange: (hazardsOff: HazardType[]) => void;
}

export default function AlertHazardChips({ hazardsOff, onChange }: Props) {
  const off = new Set(hazardsOff);
  const toggle = (id: HazardType) => {
    const next = new Set(off);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%" }}>
      <div style={{ display: "flex", gap: 10, alignItems: "center", color: "#8b95a7", fontSize: 12 }}>
        Alert types
        <button type="button" onClick={() => onChange([])} style={linkStyle} disabled={off.size === 0}>
          all
        </button>
        <button
          type="button"
          onClick={() => onChange(HAZARDS.map((h) => h.id))}
          style={linkStyle}
          disabled={off.size === HAZARDS.length}
        >
          none
        </button>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {HAZARDS.map((h) => {
          const on = !off.has(h.id);
          return (
            <button
              key={h.id}
              type="button"
              onClick={() => toggle(h.id)}
              aria-pressed={on}
              aria-label={`${h.label} alerts ${on ? "shown" : "hidden"}`}
              title={on ? `Hide ${h.label} alerts` : `Show ${h.label} alerts`}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                padding: "3px 9px",
                borderRadius: 999,
                fontSize: 12,
                cursor: "pointer",
                border: `1px solid ${on ? h.color : "#333"}`,
                background: on ? `${h.color}26` : "#141822",
                color: on ? "#fff" : "#596275",
                opacity: on ? 1 : 0.7,
              }}
            >
              <span aria-hidden>{h.icon}</span>
              {h.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const linkStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  padding: 0,
  color: "#60a5fa",
  fontSize: 12,
  cursor: "pointer",
};
