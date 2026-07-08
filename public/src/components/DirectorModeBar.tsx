"use client";

/** Auto/Off toggle, Skip, and the Settings/Log swap — always visible at the
 *  top of DirectorPanel regardless of which config tab is showing. */
import { box } from "./panelBox";

export default function DirectorModeBar({
  auto,
  onToggleAuto,
  onSkip,
  showSettings,
  onToggleSettings,
}: {
  auto: boolean;
  onToggleAuto: () => void;
  onSkip: () => void;
  showSettings: boolean;
  onToggleSettings: () => void;
}) {
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
      {auto ? (
        <button
          onClick={onToggleSettings}
          style={{ ...box, cursor: "pointer" }}
          title={showSettings ? "Back to the session log" : "Edit setup while the show is running"}
        >
          {showSettings ? "📜 Log" : "⚙ Settings"}
        </button>
      ) : null}
    </div>
  );
}
