"use client";

/**
 * One CAP <info> block on /admin/alerts/:id — headline/description/instruction
 * (English translation preferred, original shown under it), the source's own
 * parameters, and the affected areas with their geocodes.
 */
import {
  displayDescription,
  displayHeadline,
  displayInstruction,
  severityColor,
  severityLabel,
  type AlertInfo,
} from "../../lib/alerts";

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
};

function TextRow({ label, text, original }: { label: string; text?: string; original?: string }) {
  if (!text) return null;
  const translated = original && original !== text;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={rowLabel}>{label}</div>
      <div style={{ color: "#e2e8f0", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{text}</div>
      {translated && (
        <div style={{ color: "#5b6478", fontSize: 12, fontStyle: "italic", marginTop: 4, whiteSpace: "pre-wrap" }}>
          orig: {original}
        </div>
      )}
    </div>
  );
}

export default function AlertInfoBlock({ info, index }: { info: AlertInfo; index: number }) {
  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={rowLabel}>Info #{index + 1}</span>
        <span
          title={severityLabel(info.severityRank)}
          style={{
            padding: "1px 8px",
            borderRadius: 10,
            fontSize: 11,
            fontWeight: 700,
            color: "#0a0e16",
            background: severityColor(info.severityRank),
          }}
        >
          {info.severityRank} · {severityLabel(info.severityRank)}
        </span>
        <span style={{ fontWeight: 600 }}>{info.event}</span>
        {info.severity && <span style={{ color: "#8b95a7", fontSize: 12 }}>source: {info.severity}</span>}
        {info.detectedLanguage && info.translatedAt && (
          <span style={{ color: "#8b95a7", fontSize: 11, border: "1px solid #2a3344", borderRadius: 9, padding: "1px 6px" }}>
            {info.detectedLanguage.toUpperCase()}→EN
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 8, color: "#8b95a7", fontSize: 12, flexWrap: "wrap" }}>
        {info.onset && <span>onset {fmtTime(info.onset)}</span>}
        {info.effective && <span>effective {fmtTime(info.effective)}</span>}
        {info.expires && <span>expires {fmtTime(info.expires)}</span>}
        {info.web && (
          <a href={info.web} target="_blank" rel="noreferrer" style={{ color: "#60a5fa" }}>
            source page ↗
          </a>
        )}
      </div>

      <TextRow label="Headline" text={displayHeadline(info)} original={info.headline} />
      <TextRow label="Description" text={displayDescription(info)} original={info.description} />
      <TextRow label="Instruction" text={displayInstruction(info)} original={info.instruction} />

      {!!info.area?.length && (
        <div style={{ marginTop: 10 }}>
          <div style={rowLabel}>Areas ({info.area.length})</div>
          {info.area.map((a, i) => (
            <div key={i} style={{ color: "#cbd5e1", fontSize: 13, padding: "3px 0" }}>
              {a.areaDesc || "(unnamed area)"}
              {a.geometry ? <span style={{ color: "#5b6478", fontSize: 11 }}> · {a.geometry.type}</span> : null}
              {!!a.geocodes?.length && (
                <span style={{ color: "#5b6478", fontSize: 11 }}>
                  {" "}
                  · {a.geocodes.map((g) => `${g.valueName}:${g.value}`).join(", ")}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {info.parameters && Object.keys(info.parameters).length > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={rowLabel}>Parameters</div>
          <table style={{ fontSize: 12, borderCollapse: "collapse" }}>
            <tbody>
              {Object.entries(info.parameters).map(([k, v]) => (
                <tr key={k}>
                  <td style={{ color: "#5b6478", padding: "2px 14px 2px 0", whiteSpace: "nowrap", verticalAlign: "top" }}>{k}</td>
                  <td style={{ color: "#cbd5e1", padding: "2px 0", wordBreak: "break-word" }}>{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const card: React.CSSProperties = {
  padding: 14,
  borderRadius: 8,
  border: "1px solid #1b2030",
  background: "#0c111c",
  marginTop: 14,
};
const rowLabel: React.CSSProperties = {
  color: "#8b95a7",
  fontSize: 11,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};
