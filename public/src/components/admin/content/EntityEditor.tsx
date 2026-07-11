"use client";

/**
 * Schema-driven text form — renders one labelled input/textarea per editable
 * field from an entity's edit schema. Purely controlled: the parent owns the
 * values and decides what becomes an override. `dirty` fields (differing from
 * the base) get a subtle marker so the operator sees what they've changed.
 */
import type { EditFieldSpec } from "@photonsurge/shared/admin-content/schema";

const field: React.CSSProperties = {
  background: "#0a0e16",
  color: "#fff",
  border: "1px solid #1b2030",
  borderRadius: 6,
  padding: "7px 9px",
  fontSize: 13,
  width: "100%",
  fontFamily: "inherit",
};
const labelWrap: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  fontSize: 12,
  color: "#8b95a7",
};

export default function EntityEditor({
  fields,
  values,
  baseText,
  onChange,
}: {
  fields: EditFieldSpec[];
  values: Record<string, string>;
  baseText: Record<string, string>;
  onChange: (fieldId: string, value: string) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {fields.map((f) => {
        const value = values[f.field] ?? "";
        const overridden = value.trim() !== "" && value.trim() !== (baseText[f.field] ?? "").trim();
        return (
          <label key={f.field} style={labelWrap}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {f.label}
              {overridden ? (
                <span style={{ color: "#eab308", fontSize: 10, fontWeight: 800, letterSpacing: 0.5 }}>
                  ● EDITED
                </span>
              ) : null}
            </span>
            {f.type === "textarea" ? (
              <textarea
                style={{ ...field, minHeight: 84, resize: "vertical", lineHeight: 1.45 }}
                value={value}
                onChange={(e) => onChange(f.field, e.target.value)}
              />
            ) : (
              <input style={field} value={value} onChange={(e) => onChange(f.field, e.target.value)} />
            )}
            {f.hint ? <span style={{ fontSize: 11, color: "#5b6577" }}>{f.hint}</span> : null}
          </label>
        );
      })}
    </div>
  );
}
