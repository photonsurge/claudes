"use client";

/**
 * Operator stream controls for /control — the full panel: connect YouTube, go
 * live (OBS + YouTube), read live health, hand off the stream key manually when
 * OBS is unreachable, and end the stream. Mirrors DirectorPanel's boxed look.
 *
 * All credentialed work happens in the worker; this panel only calls the
 * /api/streams + /api/youtube routes and subscribes to run:state / run:status.
 */
import { useEffect, useRef, useState } from "react";
import type { RunState, StreamHealth, CreateRunRequest } from "@photonsurge/shared/runs";
import {
  useStreams,
  startStream,
  stopStream,
  fetchStreamKey,
  connectYoutube,
  type StreamAccount,
} from "../lib/stream";
import { useDirector } from "../lib/director";
import { box } from "./panelBox";
import LiveChatPanel from "./control/LiveChatPanel";

const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  scheduled: { label: "STARTING", color: "#ffb454" },
  "awaiting-ingest": { label: "AWAITING INGEST", color: "#ffb454" },
  live: { label: "LIVE", color: "#ff3b3b" },
  ending: { label: "ENDING", color: "#ffb454" },
  ended: { label: "ENDED", color: "#8b95a7" },
  stopped: { label: "STOPPED", color: "#8b95a7" },
  failed: { label: "FAILED", color: "#ff6b6b" },
};

export default function StreamPanel({ sceneId }: { sceneId: string }) {
  const { snapshot, health, error, refetch, activeRunFor } = useStreams();
  const run = activeRunFor(sceneId);
  const director = useDirector(sceneId);
  const { armed, config: armedConfig, arm, disarm } = useArmedStream(sceneId);
  const [autoErr, setAutoErr] = useState<string | null>(null);

  // Streamline: when armed, the stream starts automatically the moment the
  // broadcast goes live (the director becomes active — via the countdown, "Go live
  // now", or Auto). Fires once per activation; re-arms when the show ends.
  const firedRef = useRef(false);
  useEffect(() => {
    const live = !!director?.active;
    if (!live) {
      firedRef.current = false;
      return;
    }
    if (!armed || !armedConfig || run || firedRef.current) return;
    firedRef.current = true;
    startStream(armedConfig)
      .then(() => {
        disarm();
        refetch();
      })
      .catch((e) => {
        firedRef.current = false;
        setAutoErr(String((e as Error)?.message ?? e));
      });
  }, [director?.active, armed, armedConfig, run, disarm, refetch]);

  if (error === "admin only") return null; // panel is operator-only

  return (
    <section style={{ marginBottom: 18, borderBottom: "1px solid #1b2030", paddingBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 15 }}>Stream</h3>
        <span style={{ fontSize: 11, opacity: 0.6 }}>scene: {sceneId}</span>
      </div>

      <ConnectionRow snapshot={snapshot} />

      {run ? (
        <ActiveRun run={run} health={health[run.id]} onEnded={refetch} />
      ) : armed ? (
        <ArmedBanner
          config={armedConfig}
          broadcastLive={!!director?.active}
          error={autoErr}
          onDisarm={() => {
            disarm();
            setAutoErr(null);
          }}
          onGoNow={() => {
            firedRef.current = true;
            startStream(armedConfig!)
              .then(() => {
                disarm();
                refetch();
              })
              .catch((e) => {
                firedRef.current = false;
                setAutoErr(String((e as Error)?.message ?? e));
              });
          }}
        />
      ) : (
        <GoLiveForm
          sceneId={sceneId}
          canPublish={!!snapshot?.youtubeConfigured && (snapshot?.accounts.length ?? 0) > 0}
          obsConfigured={!!snapshot?.obsConfigured}
          onStarted={refetch}
          onArm={arm}
        />
      )}
    </section>
  );
}

/**
 * Persist the "start with broadcast" arming per scene (localStorage) so it survives
 * a /control reload during a pre-broadcast countdown. Cleared once it fires.
 */
function useArmedStream(sceneId: string) {
  const key = `streamArm:${sceneId}`;
  const [state, setState] = useState<{ armed: boolean; config: CreateRunRequest | null }>({ armed: false, config: null });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      setState(raw ? JSON.parse(raw) : { armed: false, config: null });
    } catch {
      setState({ armed: false, config: null });
    }
  }, [key]);

  const arm = (config: CreateRunRequest) => {
    const next = { armed: true, config };
    setState(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* private mode / quota — arming just won't survive reload */
    }
  };
  const disarm = () => {
    setState({ armed: false, config: null });
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };
  return { armed: state.armed, config: state.config, arm, disarm };
}

function ArmedBanner({
  config,
  broadcastLive,
  error,
  onDisarm,
  onGoNow,
}: {
  config: CreateRunRequest | null;
  broadcastLive: boolean;
  error: string | null;
  onDisarm: () => void;
  onGoNow: () => void;
}) {
  return (
    <div style={{ ...box, borderColor: "#3a7bd5", padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 16 }}>⏻</span>
        <b style={{ color: "#7dd3fc" }}>Armed — stream starts when the broadcast goes live</b>
      </div>
      <span style={{ fontSize: 12, opacity: 0.75 }}>
        {config?.platforms?.youtube ? `YouTube · ${config?.privacy ?? "unlisted"}` : "OBS only"}
        {config?.title ? ` · "${config.title}"` : ""}
        {config?.durationMs ? ` · auto-end ${Math.round(config.durationMs / 60000)}m` : ""}
        {broadcastLive ? " · waiting…" : " · broadcast is off air"}
      </span>
      {error ? <span style={{ fontSize: 12, color: "#ff6b6b" }}>{error}</span> : null}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onGoNow} style={{ ...box, cursor: "pointer", fontWeight: 600 }}>
          Go live now
        </button>
        <button onClick={onDisarm} style={{ ...box, cursor: "pointer" }}>
          Disarm
        </button>
      </div>
    </div>
  );
}

function ConnectionRow({ snapshot }: { snapshot: ReturnType<typeof useStreams>["snapshot"] }) {
  const account: StreamAccount | undefined = snapshot?.accounts?.[0];
  const ytOk = !!snapshot?.youtubeConfigured;
  const obsOk = !!snapshot?.obsConfigured;
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
      <span style={{ ...box, display: "flex", alignItems: "center", gap: 6 }}>
        <Dot on={!!account} />
        YouTube:{" "}
        {account ? (
          <b>{account.channelTitle || account.channelId}</b>
        ) : ytOk ? (
          <button onClick={connectYoutube} style={{ ...box, cursor: "pointer", padding: "2px 8px" }}>
            Connect
          </button>
        ) : (
          <span style={{ opacity: 0.6 }}>not configured</span>
        )}
      </span>
      <span style={{ ...box, display: "flex", alignItems: "center", gap: 6 }}>
        <Dot on={obsOk} />
        OBS: <span style={{ opacity: 0.8 }}>{obsOk ? "configured" : "manual"}</span>
      </span>
    </div>
  );
}

function GoLiveForm({
  sceneId,
  canPublish,
  obsConfigured,
  onStarted,
  onArm,
}: {
  sceneId: string;
  canPublish: boolean;
  obsConfigured: boolean;
  onStarted: () => void;
  onArm: (config: CreateRunRequest) => void;
}) {
  const [title, setTitle] = useState("");
  const [privacy, setPrivacy] = useState<"unlisted" | "public" | "private">("unlisted");
  const [publishYoutube, setPublishYoutube] = useState(canPublish);
  const [durationMin, setDurationMin] = useState(0);
  const [monitorStream, setMonitorStream] = useState(false);
  const [chatEnabled, setChatEnabled] = useState(false);
  const [withBroadcast, setWithBroadcast] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const buildConfig = (): CreateRunRequest => ({
    sceneId,
    title: title || undefined,
    privacy,
    durationMs: durationMin > 0 ? durationMin * 60_000 : null,
    platforms: { youtube: publishYoutube },
    monitorStream,
    chat: { enabled: chatEnabled },
  });

  const go = async () => {
    // "Start with broadcast" arms the config and hands off — the panel fires it the
    // moment the director goes live, instead of starting the stream right now.
    if (withBroadcast) {
      onArm(buildConfig());
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await startStream(buildConfig());
      onStarted();
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Broadcast title (optional)"
        style={{ ...box, padding: "6px 8px" }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={publishYoutube} disabled={!canPublish} onChange={(e) => setPublishYoutube(e.target.checked)} />
          Publish to YouTube
        </label>
        <select
          value={privacy}
          onChange={(e) => setPrivacy(e.target.value as typeof privacy)}
          disabled={!publishYoutube}
          style={{ ...box, opacity: publishYoutube ? 1 : 0.5 }}
        >
          <option value="unlisted">Unlisted</option>
          <option value="public">Public</option>
          <option value="private">Private</option>
        </select>
      </div>
      {!canPublish ? (
        <span style={{ fontSize: 11, color: "#ffb454" }}>Connect a YouTube channel above to publish.</span>
      ) : null}
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          Auto-end after
          <input
            type="number"
            min={0}
            value={durationMin}
            onChange={(e) => setDurationMin(Math.max(0, Number(e.target.value) || 0))}
            style={{ ...box, width: 64, padding: "4px 6px" }}
          />
          min <span style={{ opacity: 0.6 }}>(0 = unbounded)</span>
        </label>
      </div>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={monitorStream} disabled={!publishYoutube} onChange={(e) => setMonitorStream(e.target.checked)} />
          Preview (monitor) stream
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <input type="checkbox" checked={chatEnabled} onChange={(e) => setChatEnabled(e.target.checked)} />
          Monitor chat
        </label>
      </div>
      <label
        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, paddingTop: 4, borderTop: "1px solid #1b2030" }}
        title="Don't start now — start automatically the moment the broadcast (director) goes live."
      >
        <input type="checkbox" checked={withBroadcast} onChange={(e) => setWithBroadcast(e.target.checked)} />
        Start with the broadcast <span style={{ opacity: 0.6 }}>(go live on countdown / director start)</span>
      </label>
      {!obsConfigured ? (
        <span style={{ fontSize: 11, opacity: 0.7 }}>
          OBS not reachable — after go-live you&apos;ll get a stream key to paste into OBS by hand.
        </span>
      ) : null}
      {err ? <span style={{ fontSize: 12, color: "#ff6b6b" }}>{err}</span> : null}
      <button
        onClick={go}
        disabled={busy}
        style={{
          ...box,
          cursor: busy ? "default" : "pointer",
          fontWeight: 700,
          padding: "8px 12px",
          background: withBroadcast ? "#1e3a5f" : "#b91c1c",
          borderColor: withBroadcast ? "#3a7bd5" : "#ef4444",
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? "Starting…" : withBroadcast ? "⏻ Arm for broadcast" : "● Go Live"}
      </button>
    </div>
  );
}

function ActiveRun({ run, health, onEnded }: { run: RunState; health?: StreamHealth; onEnded: () => void }) {
  const [busy, setBusy] = useState(false);
  const status = STATUS_LABEL[run.status] ?? { label: run.status.toUpperCase(), color: "#8b95a7" };

  const end = async () => {
    setBusy(true);
    try {
      await stopStream(run.id);
      onEnded();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ ...box, color: status.color, fontWeight: 800, letterSpacing: 1 }}>{status.label}</span>
        {run.title ? <span style={{ fontSize: 13, opacity: 0.85 }}>{run.title}</span> : null}
        {run.youtube?.watchUrl ? (
          <a href={run.youtube.watchUrl} target="_blank" rel="noreferrer" style={{ ...box, color: "#7dd3fc" }}>
            Watch ↗
          </a>
        ) : null}
      </div>

      {run.error ? (
        <span style={{ fontSize: 12, color: "#ff6b6b" }}>
          {run.error.step}: {run.error.message}
        </span>
      ) : null}

      {run.needsManualObs ? <ManualHandoff runId={run.id} /> : null}

      {health ? <HealthReadout health={health} /> : null}

      {run.chat?.enabled && run.status === "live" ? <LiveChatPanel runId={run.id} /> : null}

      <button
        onClick={end}
        disabled={busy}
        style={{ ...box, cursor: busy ? "default" : "pointer", fontWeight: 700, padding: "8px 12px", opacity: busy ? 0.6 : 1 }}
      >
        {busy ? "Ending…" : "■ End stream"}
      </button>
    </div>
  );
}

function HealthReadout({ health }: { health: StreamHealth }) {
  const obs = health.obs;
  const yt = health.youtube;
  const cells: [string, string][] = [];
  if (obs?.kbps != null) cells.push(["Bitrate", `${Math.round(obs.kbps)} kbps`]);
  if (obs?.droppedRatio != null) cells.push(["Dropped", `${(obs.droppedRatio * 100).toFixed(1)}%`]);
  if (obs?.durationSec != null) cells.push(["Uptime", fmtDuration(obs.durationSec)]);
  if (obs?.reconnecting) cells.push(["OBS", "reconnecting"]);
  if (yt?.health) cells.push(["YouTube", yt.health]);
  if (yt?.streamStatus) cells.push(["Ingest", yt.streamStatus]);
  if (!cells.length) return null;
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {cells.map(([k, v]) => (
        <span key={k} style={{ ...box, fontSize: 12 }}>
          <span style={{ opacity: 0.6 }}>{k}</span> {v}
        </span>
      ))}
    </div>
  );
}

function ManualHandoff({ runId }: { runId: string }) {
  const [key, setKey] = useState<{ ingestionAddress: string; streamName: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const reveal = async () => {
    try {
      setKey(await fetchStreamKey(runId));
    } catch (e) {
      setErr(String((e as Error)?.message ?? e));
    }
  };
  return (
    <div style={{ ...box, borderColor: "#ffb454", padding: 10, display: "flex", flexDirection: "column", gap: 6 }}>
      <b style={{ fontSize: 12, color: "#ffb454" }}>OBS not connected — paste this key into OBS → Settings → Stream</b>
      {key ? (
        <>
          <Copyable label="Server" value={key.ingestionAddress} />
          <Copyable label="Stream key" value={key.streamName} secret />
        </>
      ) : (
        <button onClick={reveal} style={{ ...box, cursor: "pointer", alignSelf: "flex-start" }}>
          Show stream key
        </button>
      )}
      {err ? <span style={{ fontSize: 12, color: "#ff6b6b" }}>{err}</span> : null}
    </div>
  );
}

function Copyable({ label, value, secret }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
      <span style={{ opacity: 0.6, minWidth: 72 }}>{label}</span>
      <code style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {secret ? "•".repeat(Math.min(24, value.length)) : value}
      </code>
      <button
        onClick={() => {
          navigator.clipboard?.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        }}
        style={{ ...box, cursor: "pointer", padding: "2px 8px" }}
      >
        {copied ? "✓" : "Copy"}
      </button>
    </div>
  );
}

function Dot({ on }: { on: boolean }) {
  return (
    <span
      style={{ width: 8, height: 8, borderRadius: "50%", background: on ? "#2bbe63" : "#4b5563", display: "inline-block" }}
    />
  );
}

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}h${String(m).padStart(2, "0")}m` : `${m}m${String(s).padStart(2, "0")}s`;
}
