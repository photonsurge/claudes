"use client";

/**
 * Operator controls for the per-scene auto-director: Off/Auto toggle, Skip,
 * a pre-broadcast countdown, and a live "on air / up next" readout — always
 * visible at the top regardless of setup state. Below that, the setup form is
 * split into two tabs over ONE shared draft:
 *  - "Director settings": how the show runs — pacing/threshold knobs
 *    (DirectorTuning), hold durations for the enabled kinds (DirectorHolds),
 *    and the saved-look slide library per kind (DirectorSlides). WHICH kinds
 *    air and the country/area spotlight favourites moved to the channel's
 *    admin page (/admin/scenes/:id, DirectorSettings card).
 *  - "Map/View settings": the basemap looks each touring kind cycles through
 *    (DirectorMapTypes).
 *
 * The form is click-to-save: fields on EITHER tab edit one local `draft`
 * (`edit`) and only persist when the operator hits Save (`save`) — the Save bar
 * sits below both tabs and commits the whole draft, so a slider drag or a run of
 * checkbox ticks no longer fires a PATCH each. `dirty` drives the Save bar.
 * The always-visible Auto/Skip controls bypass the draft via `applyNow` (they
 * must take effect instantly); DirectorSlides likewise still pushes a clicked
 * slide onto the live map immediately via `applyLive` — only its saved-slide
 * config defers to Save. `config` here is the draft; the parent (/control)
 * keeps rendering the live preview from the SAVED config.
 *
 * While auto is actually running, the setup form is replaced by a "Recently
 * aired" session log (DirectorRecentlyAired) — the operator glances at what's
 * played rather than re-fiddling the setup form mid-broadcast. "⚙ Settings"
 * swaps back to the form without leaving auto.
 */
import type { DirectorConfig } from "@photonsurge/shared/director";
import type { ControlState } from "@photonsurge/shared/control";
import { useDirector } from "../lib/director";
import DirectorModeBar from "./DirectorModeBar";
import DirectorCountdown from "./DirectorCountdown";
import DirectorOnAirReadout from "./DirectorOnAirReadout";
import DirectorRecentlyAired from "./DirectorRecentlyAired";
import DirectorHolds from "./DirectorHolds";
import DirectorTuning from "./DirectorTuning";
import DirectorMapTypes from "./DirectorMapTypes";
import DirectorSlides from "./DirectorSlides";
import { box } from "./panelBox";

const TABS = [
  { id: "director", label: "Director settings" },
  { id: "map", label: "Map/View settings" },
] as const;
export type TabId = (typeof TABS)[number]["id"];

export default function DirectorPanel({
  sceneId,
  config,
  applyNow,
  edit,
  save,
  discard,
  dirty,
  liveState,
  applyLive,
  activeTab,
  onTabChange,
  showSettings,
  onToggleSettings,
}: {
  sceneId: string;
  config: DirectorConfig;
  applyNow: (patch: Partial<DirectorConfig>) => void;
  edit: (patch: Partial<DirectorConfig>) => void;
  save: () => void;
  discard: () => void;
  dirty: boolean;
  liveState: ControlState;
  applyLive: (next: ControlState) => void;
  // Tab + settings-visibility are lifted to /control so the parent can hide the
  // separate live-map ControlPanel while the operator is on the Director tab.
  activeTab: TabId;
  onTabChange: (tab: TabId) => void;
  showSettings: boolean;
  onToggleSettings: () => void;
}) {
  const live = useDirector(sceneId);
  const auto = config.mode === "auto";

  const showForm = !auto || showSettings;

  return (
    <section className="director-panel" style={{ marginBottom: 18, borderBottom: "1px solid #1b2030", paddingBottom: 16 }}>
      <style>{`
        .director-panel input[type=range] { -webkit-appearance: none; appearance: none; width: 100%; height: 10px; border-radius: 6px; background: #2a3344; outline: none; cursor: pointer; }
        .director-panel input[type=range]::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 22px; height: 22px; border-radius: 50%; background: #fff; border: 3px solid #3a7bd5; cursor: pointer; }
        .director-panel input[type=range]::-moz-range-thumb { width: 22px; height: 22px; border-radius: 50%; background: #fff; border: 3px solid #3a7bd5; cursor: pointer; }
        .director-panel input[type=range]:focus-visible { box-shadow: 0 0 0 2px #3a7bd5; }
      `}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Auto-director</h3>
        <span style={{ fontSize: 11, opacity: 0.6 }}>scene: {sceneId}</span>
      </div>

      <DirectorModeBar
        auto={auto}
        onToggleAuto={() => applyNow({ mode: auto ? "off" : "auto" })}
        onSkip={() => applyNow({ skipNonce: config.skipNonce + 1 })}
        showSettings={showSettings}
        onToggleSettings={onToggleSettings}
      />

      <DirectorCountdown
        liveState={liveState}
        applyLive={applyLive}
        auto={auto}
        startDirector={() => applyNow({ mode: "auto" })}
      />

      <DirectorOnAirReadout auto={auto} live={live} />
      <DirectorRecentlyAired sceneId={sceneId} live={live} visible={auto && !showSettings} />

      {showForm ? (
        <>
          <div style={{ fontSize: 11, opacity: 0.7, marginBottom: 8 }}>
            The channel&apos;s saved director settings (pacing, pools, tours, looks, break-ins) live on{" "}
            <a href={`/admin/scenes/${encodeURIComponent(sceneId)}?s=programme`} style={{ color: "#7fb3ff" }}>
              Channel settings ↗
            </a>
          </div>
          <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => onTabChange(t.id)}
                style={{
                  ...box,
                  cursor: "pointer",
                  flex: 1,
                  fontWeight: 600,
                  borderColor: activeTab === t.id ? "#3a7bd5" : "#2a3344",
                  opacity: activeTab === t.id ? 1 : 0.6,
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "director" ? (
            <>
              <DirectorTuning config={config} update={edit} />
              <DirectorHolds sceneId={sceneId} config={config} update={edit} />
              <DirectorSlides config={config} update={edit} liveState={liveState} applyLive={applyLive} />
            </>
          ) : (
            <DirectorMapTypes config={config} update={edit} />
          )}

          <div
            style={{
              position: "sticky",
              bottom: 0,
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginTop: 6,
              padding: "10px 0",
              background: "#0c111c",
              borderTop: "1px solid #1b2030",
            }}
          >
            <button
              type="button"
              onClick={save}
              disabled={!dirty}
              style={{
                ...box,
                cursor: dirty ? "pointer" : "default",
                fontWeight: 600,
                background: dirty ? "#1f7a3f" : box.background,
                borderColor: dirty ? "#2bbe63" : "#2a3344",
                opacity: dirty ? 1 : 0.5,
              }}
            >
              Save changes
            </button>
            <button
              type="button"
              onClick={discard}
              disabled={!dirty}
              style={{ ...box, cursor: dirty ? "pointer" : "default", opacity: dirty ? 1 : 0.5 }}
            >
              Discard
            </button>
            {dirty ? <span style={{ fontSize: 12, color: "#ffb454" }}>• Unsaved changes</span> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
