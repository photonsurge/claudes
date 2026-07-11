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
  if (roundup.narrative?.trim()) return true;
  const i = roundup.inputs;
  return Boolean(i && (i.alerts.length || i.volcanoes.length || i.topCities.length));
}

function Stat({ label, value, sub }: { label: string; value: number; sub?: string }) {
  if (!value) return null;
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: "#fff", lineHeight: 1 }}>{value.toLocaleString()}</div>
      <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 0.8, color: "#9fb3cc", marginTop: 3 }}>
        {label}
        {sub ? <span style={{ color: "#6b7a94" }}> · {sub}</span> : null}
      </div>
    </div>
  );
}

export default function PlaceRoundupPanel({
  roundup,
  theme = DEFAULT_THEME,
}: {
  roundup: PlaceRoundup;
  theme?: BroadcastTheme;
}) {
  const { narrative, inputs } = roundup;
  const narrativeText = narrative?.trim();

  // The place's biggest city (top of the pre-sorted list) as a single headline read.
  const lead = inputs.topCities[0];
  // The most severe area hazard flag, if any, as a chip under the numbers.
  const topHazard = [...(inputs.area?.hazards ?? [])].sort((a, b) => b.severityRank - a.severityRank)[0];

  const tiles = [
    { label: "ACTIVE ALERTS", value: inputs.alertsTotal ?? inputs.alerts.length },
    { label: "VOLCANOES", value: inputs.volcanoes.length },
    {
      label: lead ? lead.name.toUpperCase() : "",
      value: lead?.temp != null ? Math.round(lead.temp) : 0,
      sub: lead?.temp != null ? "°C" : undefined,
    },
  ].filter((t) => t.value > 0 && t.label);

  if (!narrativeText && !tiles.length) return null;

  return (
    <BroadcastCard theme={theme}>
      {narrativeText ? (
        <div
          style={{
            fontSize: 15,
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
      {tiles.length ? (
        <div style={{ display: "flex", gap: 18 }}>
          {tiles.map((t) => (
            <Stat key={t.label} label={t.label} value={t.value} sub={t.sub} />
          ))}
        </div>
      ) : null}
      {topHazard ? (
        <CardSection eyebrow="Top hazard">
          <span style={{ fontSize: 14, fontWeight: 700, color: "#e8eef7" }}>{topHazard.label}</span>
        </CardSection>
      ) : null}
      {!narrativeText ? (
        <div style={{ marginTop: 12, fontSize: 11, color: MUTED, letterSpacing: 0.3 }}>
          Round-up narrative pending.
        </div>
      ) : null}
    </BroadcastCard>
  );
}
