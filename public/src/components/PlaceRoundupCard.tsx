"use client";

/**
 * "Latest AI round-up" card for the /countries/[id] and /regions/[id] detail
 * pages — the newest 12h round-up narrative for one place, read from the same
 * /api/admin/place-roundups endpoint the admin index uses, with a link through
 * to the full history. Renders nothing intrusive when a place has none yet.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import { getPlaceRoundupDetail, type PlaceRoundup, type PlaceRoundupKind } from "../lib/placeRoundups";

const muted = "#8b95a7";
const panel = { border: "1px solid #1b2030", borderRadius: 9, background: "#0c111c" } as const;
const eyebrow = {
  fontSize: 10,
  fontWeight: 800,
  letterSpacing: 1.2,
  textTransform: "uppercase",
  color: "#7c88a0",
} as const;

const fmt = (v?: string | Date): string => {
  if (!v) return "—";
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
};

export default function PlaceRoundupCard({ kind, placeId }: { kind: PlaceRoundupKind; placeId: string }) {
  const [latest, setLatest] = useState<PlaceRoundup | null>(null);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getPlaceRoundupDetail(kind, placeId)
      .then((res) => {
        if (!active) return;
        setLatest(res.latest);
        setCount(res.history.length);
      })
      .catch(() => active && setLatest(null))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [kind, placeId]);

  return (
    <section style={{ ...panel, marginTop: 16, padding: 15 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <div style={{ color: "#cbd5e1", fontSize: 13 }}>Latest AI round-up</div>
        <Link href="/admin/place-roundups" style={{ color: "#93c5fd", fontSize: 12, textDecoration: "none" }}>
          All round-ups ↗
        </Link>
      </div>

      {loading ? (
        <div style={{ color: muted, fontSize: 12, marginTop: 8 }}>Loading…</div>
      ) : !latest ? (
        <div style={{ color: muted, fontSize: 12, marginTop: 6 }}>
          No round-up yet.{" "}
          {kind === "country"
            ? "Enable this country's round-up on the catalog page, then run “Country AI round-ups”."
            : "Run the “Region AI round-ups” job (Admin → Jobs)."}
        </div>
      ) : (
        <>
          <div style={{ color: muted, fontSize: 11, marginTop: 3 }}>
            Generated {fmt(latest.generatedAt)}
            {latest.prevRoundupId ? " · continues previous" : " · first round-up"}
            {count > 1 ? ` · ${count} in history` : ""}
          </div>
          {(() => {
            const summary = latest.summary?.trim();
            const stateOfPlay = latest.stateOfPlay?.trim();
            const cities = (latest.cityOutlook ?? []).filter((c) => c.name && c.outlook);
            const advice = latest.advice?.trim();
            const hasSections = Boolean(summary || stateOfPlay || cities.length || advice);
            const alertsActive =
              (latest.inputs?.alertsTotal ?? latest.inputs?.alerts?.length ?? 0) > 0 ||
              (latest.inputs?.volcanoes?.length ?? 0) > 0;

            if (hasSections) {
              return (
                <div style={{ marginTop: 10 }}>
                  {summary ? (
                    <p style={{ color: "#f1f5f9", fontWeight: 700, fontSize: 15, lineHeight: 1.5, margin: 0 }}>{summary}</p>
                  ) : null}
                  {stateOfPlay ? (
                    <p style={{ color: "#e2e8f0", lineHeight: 1.65, fontSize: 14, margin: "10px 0 0", whiteSpace: "pre-wrap" }}>
                      {stateOfPlay}
                    </p>
                  ) : null}
                  {cities.length ? (
                    <div style={{ marginTop: 14 }}>
                      <div style={eyebrow}>Next 24 hours</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 6 }}>
                        {cities.map((c) => (
                          <div key={c.name} style={{ fontSize: 13.5, lineHeight: 1.5, color: "#dbe4f0" }}>
                            <span style={{ fontWeight: 700, color: "#f1f5f9" }}>{c.name}</span> — {c.outlook}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {advice ? (
                    <div style={{ marginTop: 14 }}>
                      <div style={eyebrow}>{alertsActive ? "Advice · alerts active" : "Advice"}</div>
                      <p
                        style={{
                          color: "#eef3fa",
                          fontSize: 13.5,
                          lineHeight: 1.6,
                          margin: "6px 0 0",
                          paddingLeft: 10,
                          borderLeft: `3px solid ${alertsActive ? "#f59e0b" : "#2a3346"}`,
                          whiteSpace: "pre-wrap",
                        }}
                      >
                        {advice}
                      </p>
                    </div>
                  ) : null}
                </div>
              );
            }

            if (latest.narrative) {
              return (
                <p style={{ color: "#e2e8f0", lineHeight: 1.65, fontSize: 14, margin: "10px 0 0", whiteSpace: "pre-wrap" }}>
                  {latest.narrative}
                </p>
              );
            }

            return (
              <div style={{ color: muted, fontSize: 12, marginTop: 8, fontStyle: "italic" }}>
                {latest.narrativeStatus === "skipped"
                  ? "Narrative skipped (no OPENROUTER_API_KEY) — inputs were still captured."
                  : `Narrative error: ${latest.llm?.error ?? "unknown"}.`}
              </div>
            );
          })()}
        </>
      )}
    </section>
  );
}
