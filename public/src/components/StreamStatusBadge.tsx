"use client";

/**
 * Home-page "is the broadcast live" indicator. Reuses the same on-air signal
 * as /watch's brand-block LIVE badge: the main scene's auto-director is
 * actively driving a segment (DIRECTOR_STATE heartbeat over the socket).
 */
import { useDirector } from "../lib/director";
import { MAIN_SCENE_ID } from "@photonsurge/shared/control";

export default function StreamStatusBadge() {
  const director = useDirector(MAIN_SCENE_ID);
  const live = !!director?.active;

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
      {live && director?.segment?.title ? (
        <span style={{ color: "#8b95a7" }}>· {director.segment.title}</span>
      ) : null}
    </div>
  );
}
