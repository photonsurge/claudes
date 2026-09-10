"use client";

/**
 * WORLD REPORT deck — the auto-rotating top-right stack. Slide 1 is the
 * original DETECTION GRID (WorldSituationPanel) + ACTIVE FEED, then the deck
 * cycles chosen-location weather, single-category ALERTS / SEISMIC /
 * VOLCANOES drill-downs, and a reserved ABOUT US card. Every category slide is
 * derived from the one shared `worldWatch` tally BroadcastFrame already fetches
 * — each weather-location tile owns its point forecast. Advances on the channel's
 * `reportHoldMs` dwell (DEFAULT_REPORT_HOLD_MS when unset).
 * Pointer-inert like the rest of the chrome.
 */
import { useRef } from "react";
import { useReportCities } from "../../lib/focus/focus-client";
import type { AboutSettings, WeatherLocation } from "@photonsurge/shared/control";
import { pageDotStyle, pageDotsSlack } from "./page-dots";
import {
  applyReportPrefs,
  DEFAULT_REPORT_HOLD_MS,
  type ReportKind,
  type ReportSlideId,
} from "@photonsurge/shared/broadcast-report";
import type { WorldWatchState } from "../../lib/world-watch";
import { filterFeedByKind } from "../../lib/broadcast";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { GODS_BORDER } from "./GodsPanel";
import { usePagedSlides } from "./PointHistoryPanel";
import WorldSituationPanel from "./WorldSituationPanel";
import LocationWeatherPanel from "./LocationWeatherPanel";
import HazardScreen, { type HazardContinent } from "./HazardScreen";
import AboutPanel from "./AboutPanel";

/** The rotation order — kept as data so the count drives the dot indicator. */
export const DECK_SLIDES = ["detection", "hourly", "alerts", "seismic", "volcanoes", "about"] as const;

/** Continents carrying at least one event of a category, that category's own
 *  count first — so a single-category screen isn't padded with empty rows. */
function categoryContinents(
  byContinent: WorldWatchState["byContinent"],
  count: (c: WorldWatchState["byContinent"][number]) => number,
  segments: (c: WorldWatchState["byContinent"][number]) => { key: string; color: string; count: number }[],
): HazardContinent[] {
  return byContinent
    .map((c) => ({ name: c.continent, count: count(c), segments: segments(c) }))
    .filter((c) => c.count > 0)
    .sort((a, b) => b.count - a.count);
}

export default function WorldReportDeck({
  worldWatch,
  theme = DEFAULT_THEME,
  weatherLocations,
  areaKind,
  areaName,
  targetLocation,
  reportOff,
  reportOrder,
  reportKindsOff,
  about,
  holdMs = DEFAULT_REPORT_HOLD_MS,
}: {
  worldWatch: WorldWatchState;
  theme?: BroadcastTheme;
  /** Explicit point forecasts configured on admin/scenes/:id. */
  weatherLocations?: WeatherLocation[];
  /** Country/region spotlights show their largest cities from the current focus bundle. */
  areaKind?: string;
  areaName?: string;
  targetLocation?: WeatherLocation;
  /** Per-channel hidden report slides (ControlState.reportOff). */
  reportOff?: ReportSlideId[];
  /** Per-channel report slide ranking (ControlState.reportOrder). */
  reportOrder?: ReportSlideId[];
  /** Per-channel hidden event kinds (ControlState.reportKindsOff) — the data is
   *  already scoped upstream (useWorldWatch); the DETECTION GRID also needs it
   *  to prune the hidden kind's column/tile from its layout. */
  reportKindsOff?: ReportKind[];
  /** Per-channel ABOUT card copy (ControlState.about) — empty fields fall back to the built-in text. */
  about?: AboutSettings;
  /** Per-channel rotation dwell in ms (ControlState.reportHoldMs). */
  holdMs?: number;
}) {
  const s = worldWatch;
  // The channel's curated rotation: the natural DECK_SLIDES order with this
  // channel's hidden slides dropped and its ranking applied (a seismic channel
  // keeps seismic + volcanoes, a weather channel the report + alerts, …).
  const active = applyReportPrefs(
    DECK_SLIDES.map((id) => ({ id })),
    reportOff ?? [],
    reportOrder ?? [],
  ).map((x) => x.id);
  const cityLocations = useReportCities(areaKind);
  const isArea = areaKind === "country" || areaKind === "region";
  const locations = isArea ? cityLocations : targetLocation ? [targetLocation] : (weatherLocations ?? []).slice(0, 5);
  const { page } = usePagedSlides(active, 1, holdMs);
  const slide = active[page] ?? active[0];
  // A channel can pare the report to nothing — then render nothing (the whole
  // widget can also be hidden via widgetsOff "worldReport").
  if (active.length === 0) return null;

  const alertColor = s.bySeverity[0]?.color ?? theme.accent;
  const volcanoColor = s.byVolcanoStatus[0]?.color ?? "#f97316";

  // One page's content, by id — rendered on demand so the deck can keep the
  // pages it has shown mounted (below) without spelling each out twice.
  const pageContent = (id: ReportSlideId): React.ReactNode => {
  if (id === "hourly") {
    return <LocationWeatherPanel locations={locations} theme={theme} areaName={isArea ? areaName : undefined} detailed={Boolean(targetLocation) && !isArea} />;
  } else if (id === "alerts") {
    return (
      <HazardScreen
        title="GLOBAL ALERTS"
        heroLabel="ACTIVE ALERTS"
        heroCount={s.alertTotal}
        heroColor={alertColor}
        chips={s.bySeverity.map((b) => ({ key: String(b.rank), label: b.label, count: b.count, color: b.color }))}
        continents={categoryContinents(
          s.byContinent,
          (c) => c.alertCount,
          (c) => c.bySeverity.map((b) => ({ key: `sev:${b.rank}`, color: b.color, count: b.count })),
        )}
        feed={filterFeedByKind(s.feed, "alert")}
        emptyFeedLabel="NO SEVERE ALERTS"
        theme={theme}
      />
    );
  } else if (id === "seismic") {
    return (
      <HazardScreen
        title="SEISMIC ACTIVITY"
        heroLabel="QUAKES"
        heroCount={s.quakeCount}
        heroColor={theme.accent}
        subtitle={s.maxQuake ? `Strongest M${s.maxQuake.mag.toFixed(1)}${s.maxQuake.place ? ` · ${s.maxQuake.place}` : ""}` : undefined}
        chips={s.byMagClass.map((b) => ({ key: b.cls, label: b.label, count: b.count, color: b.color }))}
        continents={categoryContinents(
          s.byContinent,
          (c) => c.quakeCount,
          (c) => c.byMagClass.map((b) => ({ key: `mag:${b.cls}`, color: b.color, count: b.count })),
        )}
        feed={filterFeedByKind(s.feed, "quake")}
        emptyFeedLabel="NO SIGNIFICANT QUAKES"
        theme={theme}
      />
    );
  } else if (id === "volcanoes") {
    return (
      <HazardScreen
        title="VOLCANIC ACTIVITY"
        heroLabel="ACTIVE VOLCANOES"
        heroCount={s.volcanoCount}
        heroColor={volcanoColor}
        chips={s.byVolcanoStatus.map((b) => ({ key: b.status, label: b.label, count: b.count, color: b.color }))}
        continents={categoryContinents(
          s.byContinent,
          (c) => c.volcanoCount,
          (c) => c.byVolcanoStatus.map((b) => ({ key: `volc:${b.status}`, color: b.color, count: b.count })),
        )}
        feed={filterFeedByKind(s.feed, "volcano")}
        emptyFeedLabel="NO ACTIVE VOLCANOES"
        theme={theme}
      />
    );
  } else if (id === "about") {
    return <AboutPanel theme={theme} about={about} />;
  } else {
    // "detection" — the DETECTION GRID, with the full global ACTIVE FEED
    // integrated into its own card (like every other slide).
    return <WorldSituationPanel worldWatch={s} theme={theme} kindsOff={reportKindsOff} />;
  }
  };

  // Every slide now carries its ACTIVE FEED *inside* its own card — the category
  // slides a kind-filtered slice (HazardScreen), the rest the full global feed —
  // so nothing stacks a separate feed card below any more.

  // Pages that have been on screen, plus the one up next, stay mounted and are
  // skipped by layout and paint while off screen (`content-visibility`) — the
  // same lazy deck as the left column's SlideDeck. Before this, every flip tore
  // one page down and built the next from scratch: 100–320 fresh layout
  // objects, a 17–40 ms whole-document layout each time, ~250 ms of layout a
  // minute on OBS's CEF and the biggest recurring cost left in the chrome
  // (docs/watch-perf-plan.md, round 50). Mounted-but-hidden pages keep their
  // state and their tiles' fetched forecasts; a flip is now a style change.
  const shown = useRef<Set<ReportSlideId>>(new Set());
  shown.current.add(slide);
  shown.current.add(active[(page + 1) % active.length]);
  const pages = active.filter((id) => shown.current.has(id));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
      <div style={{ position: "relative" }}>
        {pages.map((id) => (
          <div
            key={id}
            aria-hidden={id !== slide}
            style={
              id === slide
                ? { position: "relative" }
                : { position: "absolute", inset: 0, opacity: 0, pointerEvents: "none", contentVisibility: "hidden" }
            }
          >
            {pageContent(id)}
          </div>
        ))}
      </div>
      {/* Slide position — a dot per ACTIVE slide so the rotation reads as
          deliberate (and a single-category channel shows a single dot). */}
      {active.length > 1 && (
        <div style={{ display: "flex", gap: 6, paddingRight: 22 + pageDotsSlack(6, 18) }}>
          {active.map((id, i) => (
            <span key={id} style={pageDotStyle(i, page, 6, 18, theme.accent, GODS_BORDER, 300)} />
          ))}
        </div>
      )}
    </div>
  );
}
