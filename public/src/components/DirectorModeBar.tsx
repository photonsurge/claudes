"use client";

/** Auto/Off toggle, Skip, and the Settings/Log swap — always visible at the
 *  top of DirectorPanel regardless of which config tab is showing. While a
 *  scripted short plays, the toggle becomes a "Playing a script" status with a
 *  Stop button (Stop = mode off; the worker's runner then stands down) — there
 *  is no Skip, a script plays its fixed lineup. */
import type { DirectorMode } from "@photonsurge/shared/director";
import { directorRunning } from "../lib/director";
import { box } from "./panelBox";

export default function DirectorModeBar({
  mode,
  onToggleAuto,
  onStop,
  onSkip,
  showSettings,
  onToggleSettings,
}: {
  mode: DirectorMode;
  onToggleAuto: () => void;
  onStop: () => void;
  onSkip: () => void;
  showSettings: boolean;
  onToggleSettings: () => void;
}) {
  const auto = mode === "auto";
  const settingsSwap = directorRunning(mode) ? (
    <button
      onClick={onToggleSettings}
      style={{ ...box, cursor: "pointer" }}
      title={showSettings ? "Back to the session log" : "Edit setup while the show is running"}
    >
      {showSettings ? "📜 Log" : "⚙ Settings"}
    </button>
  ) : null;

  if (mode === "script") {
    return (
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div
          role="status"
          style={{ ...box, flex: 1, fontWeight: 700, background: "#1a2a4a", borderColor: "#3a7bd5" }}
        >
          ▶ PLAYING A SCRIPT
        </div>
        <button
          onClick={onStop}
          style={{ ...box, cursor: "pointer", fontWeight: 700, background: "#5a1a1a", borderColor: "#c43c3c" }}
          title="Stop the script — the director goes off"
        >
          ■ Stop
        </button>
        {settingsSwap}
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <button
        onClick={onToggleAuto}
        style={{
          ...box,
          cursor: "pointer",
          flex: 1,
          fontWeight: 700,
          background: auto ? "#1f7a3f" : "#1a2030",
          borderColor: auto ? "#2bbe63" : "#2a3344",
        }}
      >
        {auto ? "● AUTO — ON" : "○ Auto — Off"}
      </button>
      <button
        onClick={onSkip}
        disabled={!auto}
        style={{ ...box, cursor: auto ? "pointer" : "not-allowed", opacity: auto ? 1 : 0.5 }}
        title="Cut to the next shot now"
      >
        Skip ⏭
      </button>
      {settingsSwap}
    </div>
  );
}
