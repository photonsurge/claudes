"use client";

/**
 * WORLD REPORT deck — the auto-rotating top-right stack. Slide 1 is the
 * original DETECTION GRID (WorldSituationPanel) + ACTIVE FEED, then the deck
 * cycles a whole-planet weather report, single-category ALERTS / SEISMIC /
 * VOLCANOES drill-downs, and a reserved ABOUT US card. Every category slide is
 * derived from the one shared `worldWatch` tally BroadcastFrame already fetches
 * — only the WORLD REPORT slide pulls extra data (the global area forecast),
 * lifted here so it doesn't refetch on each rotation. Advances on the same
 * SLIDE_HOLD_MS timer the frame's other in-panel slide rotations use.
 * Pointer-inert like the rest of the chrome.
 */
import type { WeatherManifest } from "@photonsurge/shared/manifest";
import type { AboutSettings } from "@photonsurge/shared/control";
import { applyReportPrefs, type ReportKind, type ReportSlideId } from "@photonsurge/shared/broadcast-report";
import type { WorldWatchState } from "../../lib/world-watch";
import { filterFeedByKind } from "../../lib/broadcast";
import { useAreaForecast } from "../../lib/forecast-client";
import { DEFAULT_THEME, type BroadcastTheme } from "./config";
import { usePagedSlides } from "./PointHistoryPanel";
import WorldSituationPanel from "./WorldSituationPanel";
import WorldReportPanel from "./WorldReportPanel";
import HazardScreen, { type HazardContinent } from "./HazardScreen";
import AboutPanel from "./AboutPanel";

/** Whole-planet bbox for the global "latest report" area forecast. */
const WORLD_BBOX: [number, number, number, number] = [-180, -90, 180, 90];

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
  manifest,
  theme = DEFAULT_THEME,
  reportOff,
  reportOrder,
  reportKindsOff,
  about,
}: {
  worldWatch: WorldWatchState;
  manifest: WeatherManifest | null;
  theme?: BroadcastTheme;
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
  // Lifted here (not inside the slide) so rotating away and back doesn't
  // re-trigger the global-bbox fetch each cycle.
  const worldReport = useAreaForecast(WORLD_BBOX);
  const { page } = usePagedSlides(active, 1);
  const slide = active[page] ?? active[0];
  // A channel can pare the report to nothing — then render nothing (the whole
  // widget can also be hidden via widgetsOff "worldReport").
  if (active.length === 0) return null;

  const alertColor = s.bySeverity[0]?.color ?? theme.accent;
  const volcanoColor = s.byVolcanoStatus[0]?.color ?? "#f97316";

  let content: React.ReactNode;
  if (slide === "hourly") {
    content = (
      <WorldReportPanel
        days={worldReport.days}
        loading={worldReport.loading}
        manifest={manifest}
        feed={s.feed}
        theme={theme}
      />
    );
  } else if (slide === "alerts") {
    content = (
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
  } else if (slide === "seismic") {
    content = (
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
  } else if (slide === "volcanoes") {
    content = (
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
  } else if (slide === "about") {
    content = <AboutPanel theme={theme} feed={s.feed} about={about} />;
  } else {
    // "detection" — the DETECTION GRID, with the full global ACTIVE FEED
    // integrated into its own card (like every other slide).
    content = <WorldSituationPanel worldWatch={s} theme={theme} kindsOff={reportKindsOff} />;
  }

  // Every slide now carries its ACTIVE FEED *inside* its own card — the category
  // slides a kind-filtered slice (HazardScreen), the rest the full global feed —
  // so nothing stacks a separate feed card below any more.

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "flex-end" }}>
      {content}
      {/* Slide position — a dot per ACTIVE slide so the rotation reads as
          deliberate (and a single-category channel shows a single dot). */}
      {active.length > 1 && (
        <div style={{ display: "flex", gap: 6, paddingRight: 4 }}>
          {active.map((id, i) => (
            <span
              key={id}
              style={{
                width: i === page ? 16 : 6,
                height: 6,
                borderRadius: 3,
                background: i === page ? theme.accent : "rgba(255,255,255,0.25)",
                transition: "width 0.3s, background 0.3s",
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
