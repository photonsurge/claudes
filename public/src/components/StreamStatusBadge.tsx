"use client";

/**
 * Home-page "is the broadcast live" indicator. Prefers the REAL stream signal —
 * a live streaming run on the main scene (usePublicLiveRun, secret-free public
 * feed) — and falls back to the auto-director heartbeat (director.active) when
 * no platform run is publishing, so a director-only broadcast still reads ON AIR.
 */
import { useDirector } from "../lib/director";
import { usePublicLiveRun } from "../lib/stream";
import { MAIN_SCENE_ID } from "@photonsurge/shared/control";

export default function StreamStatusBadge() {
  const director = useDirector(MAIN_SCENE_ID);
  const liveRun = usePublicLiveRun(MAIN_SCENE_ID);

  const live = !!liveRun || !!director?.active;
  const label = liveRun?.title || director?.segment?.title;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
      <style>{"@keyframes home-onair{0%,100%{opacity:1}50%{opacity:0.35}}"}</style>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: live ? "#ff3b3b" : "#4b5563",
          animation: live ? "home-onair 1.4s ease-in-out infinite" : undefined,
          flexShrink: 0,
        }}
      />
      <span style={{ fontWeight: 700, letterSpacing: 1, color: live ? "#fff" : "#8b95a7" }}>
        {live ? "ON AIR" : "OFF AIR"}
      </span>
      {live && label ? <span style={{ color: "#8b95a7" }}>· {label}</span> : null}
      {liveRun?.watchUrl ? (
        <a href={liveRun.watchUrl} target="_blank" rel="noreferrer" style={{ color: "#7dd3fc" }}>
          ↗
        </a>
      ) : null}
    </div>
  );
}
