"use client";

/**
 * Live-chat subscription for the operator LiveChatPanel. Seeds from the logged
 * history (GET /api/streams/:id/chat — written by the worker's chat poller),
 * then subscribes to the worker-emitted CHAT_MESSAGE relay, filters to one run,
 * dedupes by message id, and keeps a bounded rolling buffer. History is a
 * nice-to-have: if the fetch fails (e.g. not admin-authed) the live tail still
 * works exactly as before.
 */
import { useEffect, useRef, useState } from "react";
import { CHAT_MESSAGE, type ChatMessage } from "@photonsurge/shared/runs";
import { useSocket } from "./socket-provider";

const MAX_MESSAGES = 200;

/** A run's full logged chat history (admin-only route). */
export async function fetchChatLog(runId: string, opts: { since?: number } = {}): Promise<ChatMessage[]> {
  const qs = opts.since && opts.since > 0 ? `?since=${opts.since}` : "";
  const res = await fetch(`/api/streams/${encodeURIComponent(runId)}/chat${qs}`, { cache: "no-store" });
  if (!res.ok) throw new Error(`chat log fetch failed (${res.status})`);
  const body = (await res.json()) as { messages?: ChatMessage[] };
  return body.messages ?? [];
}

export function useChatMessages(runId: string | null): ChatMessage[] {
  const { socket } = useSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const seen = useRef<Set<string>>(new Set());

  // Reset per run, then seed with the persisted history (merged around any live
  // messages that raced in while the fetch was in flight).
  useEffect(() => {
    setMessages([]);
    seen.current = new Set();
    if (!runId) return;
    let cancelled = false;
    fetchChatLog(runId)
      .then((history) => {
        if (cancelled) return;
        setMessages((prev) => {
          const fresh = history.filter((m) => m?.id && !seen.current.has(m.id));
          fresh.forEach((m) => seen.current.add(m.id));
          const next = [...fresh, ...prev].sort((a, b) => a.ts - b.ts);
          return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
        });
      })
      .catch(() => {
        /* live-only fallback */
      });
    return () => {
      cancelled = true;
    };
  }, [runId]);

  useEffect(() => {
    if (!socket || !runId) return;
    const onChat = (payload: { data?: ChatMessage } & Partial<ChatMessage>) => {
      const m = (payload?.data ?? payload) as ChatMessage;
      if (!m?.id || m.runId !== runId) return;
      if (seen.current.has(m.id)) return;
      seen.current.add(m.id);
      setMessages((prev) => {
        const next = [...prev, m];
        return next.length > MAX_MESSAGES ? next.slice(next.length - MAX_MESSAGES) : next;
      });
    };
    socket.on(CHAT_MESSAGE, onChat);
    return () => {
      socket.off(CHAT_MESSAGE, onChat);
    };
  }, [socket, runId]);

  return messages;
}
