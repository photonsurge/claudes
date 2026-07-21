"use client";

/**
 * Operator-only live-chat mirror for a run, mounted in /control (never on /watch).
 * Shows the run's platform chat as it arrives (useChatMessages). "Promote to
 * ticker" (pushing a message onto the on-air crawl) is a deferred follow-up — the
 * ticker is currently computed from quakes/tracks/alerts, so promoting needs a new
 * operator-promoted-lines path through the broadcast render (see plan). For now
 * each message has a Copy affordance.
 */
import { useEffect, useRef } from "react";
import { useChatMessages } from "../../lib/chat";
import { box } from "../panelBox";

export default function LiveChatPanel({ runId }: { runId: string }) {
  const messages = useChatMessages(runId);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  return (
    <div style={{ ...box, padding: 8, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1, opacity: 0.7 }}>LIVE CHAT</span>
        <span style={{ fontSize: 11, opacity: 0.5 }}>{messages.length}</span>
      </div>
      <div ref={scrollRef} style={{ maxHeight: 220, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
        {messages.length === 0 ? (
          <span style={{ fontSize: 12, opacity: 0.5 }}>Waiting for messages…</span>
        ) : (
          messages.map((m) => (
            <div key={m.id} style={{ fontSize: 12, lineHeight: 1.35 }}>
              <span
                style={{
                  fontWeight: 700,
                  color: m.isOwner ? "#ffb454" : m.isMod ? "#7dd3fc" : "#cbd5e1",
                }}
              >
                {m.author}
              </span>
              {m.superchatAmount ? (
                <span style={{ color: "#2bbe63", fontWeight: 700 }}> {m.superchatAmount}</span>
              ) : null}
              <span style={{ opacity: 0.6 }}>: </span>
              <span>{m.text}</span>
              <button
                onClick={() => navigator.clipboard?.writeText(`${m.author}: ${m.text}`)}
                title="Copy"
                style={{ ...box, cursor: "pointer", padding: "0 5px", marginLeft: 6, fontSize: 10, opacity: 0.6 }}
              >
                copy
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
