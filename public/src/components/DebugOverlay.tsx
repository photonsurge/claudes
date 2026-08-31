"use client";

/**
 * Ctrl+D debug console for /watch — a semi-transparent overlay that dumps the
 * live broadcast data (rendered ControlState, director cut, overlay counts,
 * manifest…) as syntax-coloured pretty JSON. Diagnostic only: renders nothing
 * until toggled, so it never appears in an OBS capture unless opened by hand.
 *
 * Ctrl+D (or Cmd+D) toggles, Esc closes. Section headings click to collapse.
 * Values are truncated (long arrays/strings, depth, cycles) before stringify so
 * a 15k-city list or a cable geometry can't lock the tab.
 */
import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";

interface DebugOverlayProps {
  /** Section name → value; each renders as one collapsible pretty-JSON block. */
  data: Record<string, unknown>;
}

const MAX_ITEMS = 10;
const MAX_STRING = 300;
const MAX_DEPTH = 7;

/** Clone `value` into a JSON-safe, bounded shape: arrays capped at MAX_ITEMS
 *  (with a "… +N more" marker), strings at MAX_STRING, recursion at MAX_DEPTH,
 *  cycles cut, Dates → ISO. Keeps stringify cost flat no matter what's passed. */
export function prepare(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "string")
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}… (${value.length} chars)` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "boolean") return value;
  if (typeof value === "function") return "[fn]";
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "object") return String(value);
  if (seen.has(value)) return "[circular]";
  if (depth >= MAX_DEPTH) return Array.isArray(value) ? `[…${value.length} deep]` : "{…deep}";
  seen.add(value);
  if (Array.isArray(value)) {
    const out: unknown[] = value.slice(0, MAX_ITEMS).map((v) => prepare(v, depth + 1, seen));
    if (value.length > MAX_ITEMS) out.push(`… +${value.length - MAX_ITEMS} more`);
    return out;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = prepare(v, depth + 1, seen);
  return out;
}

// Token colours over an aurora-dark ground — keys cyan, strings green, numbers
// amber, keywords violet, punctuation dim.
const INK = {
  key: "#6fc9ff",
  string: "#9ee493",
  number: "#ffc76e",
  keyword: "#c9a2ff",
  punct: "rgba(255,255,255,0.5)",
};

const TOKEN = /"(?:\\.|[^"\\])*"(?:\s*:)?|\b(?:true|false|null)\b|-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;

/** Split pretty-printed JSON into coloured spans (no innerHTML). */
function highlight(json: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of json.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(<span key={i++} style={{ color: INK.punct }}>{json.slice(last, at)}</span>);
    const tok = m[0];
    const color = tok.startsWith('"')
      ? tok.endsWith(":") ? INK.key : INK.string
      : /^(true|false|null)$/.test(tok) ? INK.keyword : INK.number;
    out.push(<span key={i++} style={{ color }}>{tok}</span>);
    last = at + tok.length;
  }
  if (last < json.length) out.push(<span key={i++} style={{ color: INK.punct }}>{json.slice(last)}</span>);
  return out;
}

const mono: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: 12,
  lineHeight: 1.5,
};

function Section({ name, value }: { name: string; value: unknown }) {
  const [collapsed, setCollapsed] = useState(false);
  const json = useMemo(() => JSON.stringify(prepare(value), null, 2), [value]);
  return (
    <section style={{ marginBottom: 14 }}>
      <button
        onClick={() => setCollapsed((c) => !c)}
        style={{
          ...mono,
          display: "block",
          width: "100%",
          textAlign: "left",
          background: "none",
          border: "none",
          padding: "2px 0",
          cursor: "pointer",
          color: "rgba(255,255,255,0.9)",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
        }}
      >
        {collapsed ? "▸" : "▾"} {name}
      </button>
      {!collapsed ? (
        <pre style={{ ...mono, margin: "4px 0 0", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {highlight(json)}
        </pre>
      ) : null}
    </section>
  );
}

export default function DebugOverlay({ data }: DebugOverlayProps) {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && (e.key === "d" || e.key === "D")) {
        e.preventDefault(); // keep the browser's bookmark dialog out of the way
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (!open) return null;

  const copyAll = () => {
    const full = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, prepare(v)]));
    void navigator.clipboard?.writeText(JSON.stringify(full, null, 2));
  };

  return (
    <div
      role="dialog"
      aria-label="Debug console"
      style={{
        position: "fixed",
        inset: "3vh 3vw",
        zIndex: 100, // above StartCountdown (55) — debugging outranks the show
        display: "flex",
        flexDirection: "column",
        background: "rgba(6,10,18,0.82)",
        backdropFilter: "var(--panel-blur, blur(6px))",
        border: "1px solid rgba(255,255,255,0.15)",
        borderRadius: 12,
        boxShadow: "0 12px 48px rgba(0,0,0,0.5)",
        color: "rgba(255,255,255,0.85)",
        overflow: "hidden",
      }}
    >
      <header
        style={{
          ...mono,
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 16px",
          borderBottom: "1px solid rgba(255,255,255,0.12)",
          flex: "0 0 auto",
        }}
      >
        <strong style={{ letterSpacing: "0.14em", fontSize: 11 }}>WATCH DEBUG</strong>
        <span style={{ opacity: 0.5, fontSize: 11 }}>Ctrl+D / Esc to close</span>
        <span style={{ flex: 1 }} />
        <button onClick={copyAll} style={{ ...mono, ...chipStyle }}>Copy JSON</button>
        <button onClick={() => setOpen(false)} aria-label="Close" style={{ ...mono, ...chipStyle }}>✕</button>
      </header>
      <div style={{ flex: 1, overflow: "auto", padding: "12px 16px" }}>
        {Object.entries(data).map(([name, value]) => (
          <Section key={name} name={name} value={value} />
        ))}
      </div>
    </div>
  );
}

const chipStyle: CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  border: "1px solid rgba(255,255,255,0.15)",
  borderRadius: 6,
  color: "rgba(255,255,255,0.85)",
  fontSize: 11,
  padding: "3px 10px",
  cursor: "pointer",
};
