"use client";

/**
 * The public home's "what's on": one card per broadcast channel with its ON AIR
 * state, the shot the director is airing now / has queued next, and — when the
 * channel is publishing to YouTube — the public watch page and live-chat popout.
 *
 * Viewer-facing and anonymous-safe: it reads only the ungated /api/scenes list
 * (watchToken is already stripped for a sessionless request) and the
 * secret-free /api/streams/live feed, and it never offers an operator control —
 * no Control / Watch / Settings links and no Next button. Those live in
 * ChannelLauncher, which the same URL shows a signed-in operator instead.
 *
 * Live channels sort first. A channel with neither a platform run nor a
 * director heartbeat reads "Off air" with no links; one the director is driving
 * but nothing is publishing still reads ON AIR (same fallback as the operator
 * launcher) but has nothing to link to.
 */
import { useEffect, useState } from "react";
import type { SceneMeta } from "@photonsurge/shared/control";
import { listScenes } from "../lib/scenes";
import { useDirector } from "../lib/director";
import { usePublicLiveRuns, type PublicRunLite } from "../lib/stream";
import ChannelNowNext from "./ChannelNowNext";

const MUTED: React.CSSProperties = { color: "#8b95a7", fontSize: 14, margin: 0 };

export default function PublicChannels() {
  const [scenes, setScenes] = useState<SceneMeta[] | null>(null);
  const liveRuns = usePublicLiveRuns();

  useEffect(() => {
    listScenes()
      .then(setScenes)
      .catch(() => setScenes([]));
  }, []);

  if (scenes === null) return <p style={MUTED}>Loading…</p>;
  if (scenes.length === 0) return <p style={MUTED}>No channels yet.</p>;

  const ordered = [...scenes].sort((a, b) => Number(!!liveRuns[b.id]) - Number(!!liveRuns[a.id]));
  const watchable = ordered.some((s) => !!liveRuns[s.id]?.watchUrl);

  return (
    <section style={{ width: "100%", maxWidth: 820 }}>
      <style>{"@keyframes pub-onair{0%,100%{opacity:1}50%{opacity:0.35}}"}</style>
      <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "#8b95a7", marginBottom: 10 }}>
        On now
      </div>
      {!watchable && (
        <p style={{ ...MUTED, marginBottom: 14 }}>Nothing is streaming right now — check back soon.</p>
      )}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
        {ordered.map((s) => (
          <PublicCard key={s.id} scene={s} run={liveRuns[s.id] ?? null} />
        ))}
      </div>
    </section>
  );
}

function PublicCard({ scene, run }: { scene: SceneMeta; run: PublicRunLite | null }) {
  const director = useDirector(scene.id);
  const live = !!run || !!director?.active;

  return (
    <article
      aria-label={scene.name}
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        border: `1px solid ${live ? "#7f1d1d" : "#2a3142"}`,
        background: "#121826",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 600, color: "#fff" }}>{scene.name}</div>
        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              background: live ? "#ff3b3b" : "#4b5563",
              animation: live ? "pub-onair 1.4s ease-in-out infinite" : undefined,
              flexShrink: 0,
            }}
          />
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, color: live ? "#fff" : "#8b95a7" }}>
            {live ? "ON AIR" : "OFF AIR"}
          </span>
        </span>
      </div>
      {run?.title ? <div style={{ ...MUTED, fontSize: 13, marginBottom: 10 }}>{run.title}</div> : null}
      <ChannelNowNext sceneId={scene.id} director={director} readOnly />
      {run?.watchUrl || run?.chatUrl ? (
        <div style={{ display: "flex", gap: 16, fontSize: 14, flexWrap: "wrap" }}>
          {run.watchUrl && (
            <a href={run.watchUrl} target="_blank" rel="noreferrer" style={{ color: "#ff8a8a", textDecoration: "none", fontWeight: 600 }}>
              Watch on YouTube ↗
            </a>
          )}
          {run.chatUrl && (
            <a href={run.chatUrl} target="_blank" rel="noreferrer" style={{ color: "#6b93e0", textDecoration: "none" }}>
              Live chat ↗
            </a>
          )}
        </div>
      ) : null}
    </article>
  );
}
