"use client";

import { useEffect, useState } from "react";
import { useSocket } from "../lib/socket-provider";

type PingDone = {
  type: string;
  jobId?: string;
  data?: { id?: string; message?: string; processedAt?: string };
};

/**
 * Demonstrates the full round-trip:
 *   button -> POST /api/ping -> queue -> worker -> socket -> here.
 */
export default function PingPanel() {
  const { socket, connected } = useSocket();
  const [events, setEvents] = useState<PingDone[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!socket) return;
    const onDone = (payload: PingDone) => setEvents((prev) => [payload, ...prev].slice(0, 20));
    socket.on("ping:done", onDone);
    return () => {
      socket.off("ping:done", onDone);
    };
  }, [socket]);

  const sendPing = async () => {
    setSending(true);
    try {
      await fetch("/api/ping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `ping @ ${new Date().toLocaleTimeString()}` }),
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ maxWidth: 640, margin: "3rem auto", padding: "0 1rem" }}>
      <h1>Blank App</h1>
      <p style={{ color: "#666" }}>public → queue → worker → socket → browser</p>

      <p>
        socket:{" "}
        <strong style={{ color: connected ? "#16a34a" : "#dc2626" }}>
          {connected ? "connected" : "disconnected"}
        </strong>
      </p>

      <button
        onClick={sendPing}
        disabled={sending}
        style={{
          padding: "0.6rem 1.2rem",
          fontSize: 16,
          cursor: sending ? "default" : "pointer",
          borderRadius: 8,
          border: "1px solid #ccc",
          background: "#111",
          color: "#fff",
        }}
      >
        {sending ? "Sending…" : "Send ping"}
      </button>

      <h2 style={{ marginTop: "2rem" }}>Events from worker</h2>
      {events.length === 0 ? (
        <p style={{ color: "#999" }}>No events yet. Press “Send ping”.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0 }}>
          {events.map((e, i) => (
            <li
              key={`${e.data?.id ?? i}`}
              style={{ padding: "0.5rem 0.75rem", borderBottom: "1px solid #eee", fontFamily: "monospace", fontSize: 13 }}
            >
              <strong>{e.type}</strong> — {e.data?.message} <span style={{ color: "#999" }}>({e.data?.id})</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
