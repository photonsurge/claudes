"use client";

/**
 * Search + group filter for /admin/jobs. The catalog is ~60 jobs across a dozen
 * groups, which is well past "scan the page to find it" — this is how you get to
 * one.
 */
interface JobsToolbarProps {
  query: string;
  onQuery: (q: string) => void;
  groups: Array<[string, number]>;
  active: string | null;
  onGroup: (g: string | null) => void;
  total: number;
  shown: number;
}

const chipBase: React.CSSProperties = {
  padding: "5px 11px",
  borderRadius: 999,
  fontSize: 12,
  cursor: "pointer",
  whiteSpace: "nowrap",
};

export default function JobsToolbar({ query, onQuery, groups, active, onGroup, total, shown }: JobsToolbarProps) {
  const chip = (label: string, count: number, selected: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      style={{
        ...chipBase,
        border: `1px solid ${selected ? "#2563eb" : "#242b3d"}`,
        background: selected ? "#1c2c50" : "#0c111c",
        color: selected ? "#dfe7f5" : "#8b95a7",
      }}
    >
      {label} <span style={{ opacity: 0.6 }}>{count}</span>
    </button>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <input
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search jobs…"
          aria-label="Search jobs"
          style={{
            flex: "1 1 260px",
            maxWidth: 380,
            padding: "8px 12px",
            borderRadius: 6,
            border: "1px solid #242b3d",
            background: "#0c111c",
            color: "#fff",
            fontSize: 13,
          }}
        />
        <span style={{ color: "#5b6577", fontSize: 12 }}>
          {shown === total ? `${total} jobs` : `${shown} of ${total} jobs`}
        </span>
      </div>
      <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
        {chip("All", total, active === null, () => onGroup(null))}
        {groups.map(([g, n]) => chip(g, n, active === g, () => onGroup(active === g ? null : g)))}
      </div>
    </div>
  );
}
