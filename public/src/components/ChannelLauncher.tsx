"use client";

/**
 * Home-page channel launcher: one card per broadcast channel (a scene) with a
 * link to its operator console (/control?scene=:id) and its full-screen output
 * (/watch/:id). Mirrors the links on /admin/scenes so the signed-in home page
 * is a fast jump-off to drive or preview any channel.
 *
 * Each card also carries the director's NOW/NEXT shots and a Next button that
 * cuts the channel to the queued shot (ChannelNowNext), so the launcher can drive
 * a running channel without opening its console. A crossword channel has no
 * director: its card shows the puzzle and its progress (ChannelPuzzleLine) and
 * links its Desk instead of /control. Watch links come from `outputPath`.
 *
 * Each card carries its own ON AIR state: a live streaming run on the channel
 * (usePublicLiveRuns) is the real signal — and when that run publishes to
 * YouTube the card links straight to the public watch page and the live-chat
 * popout. With no platform run the director heartbeat keeps a director-only
 * broadcast reading ON AIR (same fallback as StreamStatusBadge).
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { MAIN_SCENE_ID, sceneSurface, outputPath, type SceneMeta } from "@photonsurge/shared/control";
import { listScenes } from "../lib/scenes";
import { useDirector } from "../lib/director";
import { usePublicLiveRuns, type PublicRunLite } from "../lib/stream";
import { consoleHref, settingsHref } from "../lib/channel-links";
import ChannelNowNext from "./ChannelNowNext";
import ChannelPuzzleLine from "./ChannelPuzzleLine";

export default function ChannelLauncher() {
  const [scenes, setScenes] = useState<SceneMeta[] | null>(null);
  const liveRuns = usePublicLiveRuns();

  useEffect(() => {
    // Hidden scenes are production surfaces (the short-video scenes), not channels.
    listScenes()
      .then((list) => setScenes(list.filter((s) => !s.hidden)))
      .catch(() => setScenes([]));
  }, []);

  return (
    <section style={{ width: "100%", maxWidth: 820 }}>
      <style>{"@keyframes chan-onair{0%,100%{opacity:1}50%{opacity:0.35}}"}</style>
      <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "#8b95a7", marginBottom: 10 }}>
        Channels
      </div>
      {scenes === null ? (
        <div style={{ color: "#8b95a7", fontSize: 14 }}>Loading channels…</div>
      ) : scenes.length === 0 ? (
        <div style={{ color: "#8b95a7", fontSize: 14 }}>
          No channels yet — create one in{" "}
          <Link href="/admin/scenes" style={{ color: "#6b93e0" }}>
            Channels admin
          </Link>
          .
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
            gap: 12,
          }}
        >
          {scenes.map((s) => (
            <ChannelCard key={s.id} scene={s} run={liveRuns[s.id] ?? null} />
          ))}
        </div>
      )}
    </section>
  );
}

function ChannelCard({ scene, run }: { scene: SceneMeta; run: PublicRunLite | null }) {
  const director = useDirector(scene.id);
  const crossword = sceneSurface(scene) === "crossword";
  // A crossword has no director heartbeat to fall back on; only a run is live.
  const live = !!run || (!crossword && !!director?.active);

  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        border: `1px solid ${live ? "#7f1d1d" : "#2a3142"}`,
        background: "#121826",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>{scene.name}</div>
        {scene.id === MAIN_SCENE_ID && (
          <span style={{ fontSize: 11, color: "#8b95a7", border: "1px solid #2a3142", borderRadius: 4, padding: "1px 6px" }}>
            main
          </span>
        )}
        {live && (
          <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
            <span
              style={{
                width: 7,
                height: 7,
                borderRadius: "50%",
                background: "#ff3b3b",
                animation: "chan-onair 1.4s ease-in-out infinite",
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: "#fff" }}>ON AIR</span>
          </span>
        )}
      </div>
      {crossword ? (
        <ChannelPuzzleLine sceneId={scene.id} />
      ) : (
        <ChannelNowNext sceneId={scene.id} director={director} />
      )}
      <div style={{ display: "flex", gap: 16, fontSize: 14, flexWrap: "wrap" }}>
        <Link href={consoleHref(scene)} style={{ color: "#6b93e0", textDecoration: "none" }}>
          {crossword ? "Desk" : "Control"}
        </Link>
        <Link href={outputPath(scene)} target="_blank" rel="noreferrer" style={{ color: "#6b93e0", textDecoration: "none" }}>
          Watch ↗
        </Link>
        <Link href={settingsHref(scene.id)} style={{ color: "#6b93e0", textDecoration: "none" }}>
          Settings
        </Link>
        {run?.watchUrl && (
          <a href={run.watchUrl} target="_blank" rel="noreferrer" style={{ color: "#ff8a8a", textDecoration: "none" }}>
            YouTube ↗
          </a>
        )}
        {run?.chatUrl && (
          <a href={run.chatUrl} target="_blank" rel="noreferrer" style={{ color: "#ff8a8a", textDecoration: "none" }}>
            Chat ↗
          </a>
        )}
      </div>
    </div>
  );
}
