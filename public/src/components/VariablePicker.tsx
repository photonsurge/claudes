"use client";

/** Picks the active scalar colour field (or none). */
import { VARIABLE_REGISTRY, SCALAR_VARIABLE_IDS } from "@photonsurge/shared/variables";

export interface VariablePickerProps {
  value: string | null;
  onChange: (variableId: string | null) => void;
}

export default function VariablePicker({ value, onChange }: VariablePickerProps) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
      <button
        type="button"
        onClick={() => onChange(null)}
        aria-pressed={value === null}
        style={btn(value === null)}
      >
        None
      </button>
      {SCALAR_VARIABLE_IDS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={value === id}
          style={btn(value === id)}
        >
          {VARIABLE_REGISTRY[id]?.label ?? id}
        </button>
      ))}
    </div>
  );
}

function btn(active: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #333",
    background: active ? "#2563eb" : "#1a1f2b",
    color: "#fff",
    cursor: "pointer",
    fontSize: 13,
  };
}
