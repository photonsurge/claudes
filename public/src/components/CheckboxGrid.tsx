"use client";

/** A two-column scrollable checkbox list — the shared shape behind the
 *  favourite-countries and favourite-sea-points pickers in DirectorSpotlights. */
export default function CheckboxGrid({
  items,
  selected,
  onToggle,
}: {
  items: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string, on: boolean) => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "2px 10px",
        maxHeight: 180,
        overflowY: "auto",
        paddingRight: 4,
      }}
    >
      {items.map((it) => {
        const on = selected.includes(it.id);
        return (
          <label key={it.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
            <input type="checkbox" checked={on} onChange={() => onToggle(it.id, on)} />
            {it.label}
          </label>
        );
      })}
    </div>
  );
}
