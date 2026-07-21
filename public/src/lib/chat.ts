"use client";

/**
 * Live-chat subscription for the operator LiveChatPanel. Subscribes to the
 * worker-emitted CHAT_MESSAGE relay, filters to one run, dedupes by message id,
 * and keeps a bounded rolling buffer (chat is ephemeral — never fetched/persisted).
 */
import { useEffect, useRef, useState } from "react";
import { CHAT_MESSAGE, type ChatMessage } from "@photonsurge/shared/runs";
import { useSocket } from "./socket-provider";

const MAX_MESSAGES = 200;

export function useChatMessages(runId: string | null): ChatMessage[] {
  const { socket } = useSocket();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    setMessages([]);
    seen.current = new Set();
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
