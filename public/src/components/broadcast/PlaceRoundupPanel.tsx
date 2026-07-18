"use client";

/**
 * Per-place round-up card — the AI narrative of what the weather + hazards are
 * doing across the country (or, later, region) currently framed, plus a compact
 * tally of the place-scoped inputs the narrative was written from (active alerts,
 * active volcanoes, biggest-city read, top hazard). This is the country
 * spotlight's SECOND slide — the "state of the nation" beat right after the
 * on-air lede — sourced from the place-roundups feature (CountryRoundup), unlike
 * RoundupStatsPanel which carries the GLOBAL event round-up on world spins.
 */
import type { PlaceRoundup } from "../../lib/placeRoundups";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import BroadcastCard, { CardSection, DIVIDER, MUTED } from "./BroadcastCard";

/** True when a place round-up carries anything worth a slide (prose or inputs). */
export function placeRoundupSlideHasContent(roundup: PlaceRoundup | null | undefined): boolean {
  if (!roundup) return false;
  if (roundup.summary?.trim() || roundup.stateOfPlay?.trim() || roundup.advice?.trim()) return true;
  if (roundup.cityOutlook?.length) return true;
  if (roundup.narrative?.trim()) return true;
  const i = roundup.inputs;
  return Boolean(i && (i.alerts.length || i.volcanoes.length || i.topCities.length));
}

/** The "state of the place" text/tally half of a round-up (everything EXCEPT the
 *  per-city next-24h outlook) — the `section="main"` slide. */
export function placeRoundupMainHasContent(roundup: PlaceRoundup | null | undefined): boolean {
  if (!roundup) return false;
  if (roundup.summary?.trim() || roundup.stateOfPlay?.trim() || roundup.advice?.trim() || roundup.narrative?.trim())
    return true;
  const i = roundup.inputs;
  return Boolean(i && (i.alerts.length || i.volcanoes.length || i.topCities.length));
}

/** The per-city NEXT 24 HOURS outlook half of a round-up — the `section="next24"`
 *  slide (split off so the 24h events read on their own page). */
export function placeRoundupNext24HasContent(roundup: PlaceRoundup | null | undefined): boolean {
  return Boolean(roundup?.cityOutlook?.some((c) => c.name && c.outlook));
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  if (!value) return null;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 24.2, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 0.8, color: "#9fb3cc", marginTop: 3 }}>
        {label}
        {sub ? <span style={{ color: "#6b7a94" }}> · {sub}</span> : null}
      </div>
    </div>
  );
}

export default function PlaceRoundupPanel({
  roundup,
  section = "all",
  theme = DEFAULT_THEME,
}: {
  roundup: PlaceRoundup;
  /** Which half of the round-up to render — the region deck splits it so the
   *  per-city NEXT 24 HOURS outlook reads on its own slide after the state text.
   *  "all" (default, used by the country deck) keeps everything on one card. */
  section?: "all" | "main" | "next24";
  theme?: BroadcastTheme;
}) {
  const showMain = section !== "next24";
  const showNext24 = section !== "main";
  const { narrative, summary, stateOfPlay, cityOutlook, advice, inputs } = roundup;
  const summaryText = summary?.trim();
  const stateText = stateOfPlay?.trim();
  const cities = (cityOutlook ?? []).filter((c) => c.name && c.outlook);
  const adviceText = advice?.trim();
  const hasSections = Boolean(summaryText || stateText || cities.length || adviceText);
  // Older round-ups (pre-sections) only carry the composed narrative.
  const narrativeText = narrative?.trim();

  const activeAlerts = inputs.alertsTotal ?? inputs.alerts.length;

  // The place's biggest city (top of the pre-sorted list) as a single headline read.
  const lead = inputs.topCities[0];
  // The most severe area hazard flag, if any, as a chip under the numbers.
  const topHazard = [...(inputs.area?.hazards ?? [])].sort((a, b) => b.severityRank - a.severityRank)[0];

  const tiles = [
    { label: "ACTIVE ALERTS", value: activeAlerts },
    { label: "VOLCANOES", value: inputs.volcanoes.length },
    {
      label: lead ? lead.name.toUpperCase() : "",
      value: lead?.temp != null ? Math.round(lead.temp) : 0,
      sub: lead?.temp != null ? "°C" : undefined,
    },
  ].filter((t) => t.value > 0 && t.label);

  // Section-aware self-hide: the "main" (state text/tally) half needs prose or
  // tiles; the "next24" half needs the per-city outlook.
  const renderMain = showMain && (hasSections || narrativeText || tiles.length > 0);
  const renderNext24 = showNext24 && cities.length > 0;
  if (!renderMain && !renderNext24) return null;

  // Advice reads louder when there's something to warn about.
  const adviceUrgent = activeAlerts > 0 || inputs.volcanoes.length > 0;

  return (
    <BroadcastCard theme={theme}>
      {showMain && hasSections ? (
        <>
          {summaryText ? (
            <div style={{ fontSize: 17.6, fontWeight: 700, lineHeight: 1.4, color: "#fff", marginBottom: stateText ? 10 : 0 }}>
              {summaryText}
            </div>
          ) : null}
          {stateText ? (
            <div
              style={{
                fontSize: 16,
                lineHeight: 1.5,
                color: "#e8eef7",
                marginBottom: tiles.length || topHazard ? 12 : 0,
                paddingBottom: tiles.length || topHazard ? 10 : 0,
                borderBottom: tiles.length || topHazard ? DIVIDER : undefined,
              }}
            >
              {stateText}
            </div>
          ) : null}
        </>
      ) : showMain && narrativeText ? (
        <div
          style={{
            fontSize: 16.5,
            lineHeight: 1.5,
            color: "#e8eef7",
            marginBottom: tiles.length || topHazard ? 12 : 0,
            paddingBottom: tiles.length || topHazard ? 10 : 0,
            borderBottom: tiles.length || topHazard ? DIVIDER : undefined,
          }}
        >
          {narrativeText}
        </div>
      ) : null}

      {showMain && tiles.length ? (
        <div style={{ display: "flex", gap: 18 }}>
          {tiles.map((t) => (
            <Stat key={t.label} label={t.label} value={t.value} sub={t.sub} />
          ))}
        </div>
      ) : null}
      {showMain && topHazard ? (
        <CardSection eyebrow="Top hazard">
          <span style={{ fontSize: 15.4, fontWeight: 700, color: "#e8eef7" }}>{topHazard.label}</span>
        </CardSection>
      ) : null}

      {showNext24 && cities.length ? (
        <CardSection eyebrow="Next 24 hours" first={section === "next24"}>
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {cities.map((c) => (
              <div key={c.name} style={{ fontSize: 14.9, lineHeight: 1.4, color: "#e8eef7" }}>
                <span style={{ fontWeight: 800, color: "#fff" }}>{c.name}</span>
                <span style={{ color: "#c4d0e0" }}> — {c.outlook}</span>
              </div>
            ))}
          </div>
        </CardSection>
      ) : null}

      {showMain && adviceText ? (
        <CardSection eyebrow={adviceUrgent ? "Advice · alerts active" : "Advice"}>
          <div
            style={{
              fontSize: 14.9,
              lineHeight: 1.5,
              color: "#eef3fa",
              paddingLeft: 10,
              borderLeft: `3px solid ${adviceUrgent ? "#f59e0b" : "rgba(120,140,170,0.35)"}`,
            }}
          >
            {adviceText}
          </div>
        </CardSection>
      ) : null}

      {showMain && !hasSections && !narrativeText ? (
        <div style={{ marginTop: 12, fontSize: 12.1, color: MUTED, letterSpacing: 0.3 }}>
          Round-up narrative pending.
        </div>
      ) : null}
    </BroadcastCard>
  );
}
