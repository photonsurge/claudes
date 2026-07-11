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
          {latest.narrative ? (
            <p style={{ color: "#e2e8f0", lineHeight: 1.65, fontSize: 14, margin: "10px 0 0", whiteSpace: "pre-wrap" }}>
              {latest.narrative}
            </p>
          ) : (
            <div style={{ color: muted, fontSize: 12, marginTop: 8, fontStyle: "italic" }}>
              {latest.narrativeStatus === "skipped"
                ? "Narrative skipped (no OPENROUTER_API_KEY) — inputs were still captured."
                : `Narrative error: ${latest.llm?.error ?? "unknown"}.`}
            </div>
          )}
        </>
      )}
    </section>
  );
}
