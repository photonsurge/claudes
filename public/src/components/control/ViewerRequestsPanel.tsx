"use client";

/**
 * Viewer requests on /control: the music / palette picks viewers have on air
 * (with what's left of each), what's waiting, Clear all, and the chat
 * SIMULATOR — "say this as a viewer" goes through the same worker handler as
 * live chat, so a channel's chat policy can be tested with no live stream. The
 * channel's replies appear in the transcript; nothing is sent to YouTube.
 * Effects are real: use it on a test channel or between streams.
 */
import { useEffect, useState } from "react";
import type { ChatSettings } from "@photonsurge/shared/control";
import { activePicks } from "@photonsurge/shared/viewer";
import { useViewerState } from "../../lib/viewer";
import { useChatMessages } from "../../lib/chat";
import { box } from "../panelBox";

const btn = { ...box, cursor: "pointer", padding: "3px 8px", fontSize: 12 } as const;
const left = (until: number, now: number) => `${Math.max(0, Math.ceil((until - now) / 60_000))}m`;

export async function simulateChat(sceneId: string, msg: { author: string; text: string; isMod: boolean }): Promise<boolean> {
  try {
    const res = await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/chat-sim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(msg),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function clearViewerPicks(sceneId: string): Promise<boolean> {
  try {
    return (await fetch(`/api/scenes/${encodeURIComponent(sceneId)}/viewer/clear`, { method: "POST" })).ok;
  } catch {
    return false;
  }
}

export default function ViewerRequestsPanel({ sceneId, chat }: { sceneId: string; chat: ChatSettings }) {
  const viewer = useViewerState(sceneId);
  const transcript = useChatMessages(`sim:${sceneId}`);
  const [now, setNow] = useState(() => Date.now());
  const [author, setAuthor] = useState("tester");
  const [text, setText] = useState("");
  const [isMod, setIsMod] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, []);

  if (!chat.enabled || !chat.commands.enabled) return null;
  const picks = Object.values(activePicks(viewer, now));

  const say = async () => {
    if (!text.trim()) return;
    setError(null);
    if (await simulateChat(sceneId, { author, text, isMod })) setText("");
    else setError("couldn't reach the worker");
  };

  return (
    <section style={{ marginBottom: 18, borderBottom: "1px solid #1b2030", paddingBottom: 16 }} aria-label="Viewer requests">
      <h3 style={{ margin: "0 0 10px", fontSize: 15 }}>Viewer requests</h3>
      <div style={{ fontSize: 12, marginBottom: 8 }} aria-label="Viewer picks on air">
        {picks.length ? (
          picks.map((p) => (
            <div key={p!.slot}>
              {p!.slot === "audioMode" ? "Music" : "Palette"}: <strong>{p!.label}</strong> · @{p!.by.author} · {left(p!.until, now)} left
            </div>
          ))
        ) : (
          <div style={{ opacity: 0.6 }}>No viewer picks on air</div>
        )}
        {viewer?.queue.length ? <div style={{ opacity: 0.7 }}>Waiting: {viewer.queue.map((q) => q.label).join(", ")}</div> : null}
      </div>
      <button type="button" style={btn} disabled={!picks.length && !viewer?.queue.length} onClick={() => void clearViewerPicks(sceneId)}>
        Clear all
      </button>

      <div style={{ fontSize: 12, opacity: 0.8, margin: "12px 0 4px" }}>Chat simulator (replies stay here, nothing goes to YouTube)</div>
      <form
        style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
        onSubmit={(e) => {
          e.preventDefault();
          void say();
        }}
      >
        <input aria-label="Simulated author" value={author} onChange={(e) => setAuthor(e.target.value)} style={{ ...box, width: 90 }} />
        <input
          aria-label="Simulated message"
          placeholder=":music deep 5"
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ ...box, flex: 1, minWidth: 120 }}
        />
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 4 }}>
          <input type="checkbox" checked={isMod} onChange={(e) => setIsMod(e.target.checked)} /> mod
        </label>
        <button type="submit" style={btn} disabled={!text.trim()}>
          Say
        </button>
      </form>
      {error ? (
        <div role="alert" style={{ fontSize: 12, color: "#ffb454" }}>
          {error}
        </div>
      ) : null}
      {transcript.length ? (
        <div style={{ fontSize: 12, marginTop: 6, maxHeight: 140, overflowY: "auto" }} aria-label="Simulator transcript">
          {transcript.slice(-12).map((m) => (
            <div key={m.id} style={{ opacity: m.isOwner ? 0.85 : 1 }}>
              <strong>{m.author}</strong>: {m.text}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
