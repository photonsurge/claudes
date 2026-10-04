/**
 * BullMQ entry points for viewer chat (shared/viewer.ts, chat-policy.ts):
 *   viewer-chat.inject { sceneId, author, text, isMod? }  — the operator's chat
 *     simulator: the message goes through the SAME handler as live chat, its
 *     replies come back to the operator panel (never to YouTube), and nothing
 *     is written to the chat log. Its effects on the scene are real.
 *   viewer-chat.clear  { sceneId }  — the operator's "Clear all".
 * Routed to the FOREGROUND tier (bull-utils) — an operator is watching.
 */
import type { Job } from "bullmq";
import { getAppDb } from "@photonsurge/shared/db/index";
import { CHAT_MESSAGE, type ChatMessage } from "@photonsurge/shared/runs";
import { VIEWER_STATE, clearViewerState } from "@photonsurge/shared/viewer";
import { emitWorkerEvent } from "../socket";
import { commandReplies } from "../stream/chat-commands";
import { defaultHandlerDeps, handleChatBatch } from "../stream/chat-handler";

/** The pseudo run id simulator traffic is relayed under (the panel listens for it). */
export const simRunId = (sceneId: string) => `sim:${sceneId}`;

const field = (job: Job, key: string) => (job.data?.data ?? job.data ?? {})[key];

export async function inject(job: Job) {
  const sceneId = String(field(job, "sceneId") ?? "");
  const author = String(field(job, "author") ?? "").trim().slice(0, 60) || "viewer";
  const text = String(field(job, "text") ?? "").slice(0, 200);
  const isMod = field(job, "isMod") === true;
  if (!sceneId || !text.trim()) throw new Error("viewer-chat.inject: missing sceneId or text");

  const now = Date.now();
  const runId = simRunId(sceneId);
  const relay = (msg: Omit<ChatMessage, "runId" | "sceneId" | "platform" | "ts">) =>
    emitWorkerEvent({ type: CHAT_MESSAGE, data: { runId, sceneId, platform: "youtube", ts: Date.now(), ...msg } });

  relay({ id: `sim-${now}-${Math.random().toString(36).slice(2, 8)}`, author, text, ...(isMod ? { isMod: true } : {}) });

  // The always-on info commands answer exactly as they would live.
  const info = await commandReplies({ id: runId, sceneId } as never, [{ runId, sceneId, platform: "youtube", id: `sim-${now}`, author, text, ts: now }], now);
  const viewer = await handleChatBatch(sceneId, [{ author, text, isMod, platform: "sim" }], await defaultHandlerDeps(), now);
  const replies = [...info, ...viewer.replies];
  replies.forEach((reply, i) => relay({ id: `sim-bot-${now}-${i}`, author: "🤖 channel", text: reply, isOwner: true }));
  return { sceneId, replies };
}

export async function clear(job: Job) {
  const sceneId = String(field(job, "sceneId") ?? "");
  if (!sceneId) throw new Error("viewer-chat.clear: missing sceneId");
  const db = await getAppDb();
  const state = clearViewerState(await db.viewerState.get(sceneId), Date.now());
  await db.viewerState.save(state);
  emitWorkerEvent({ type: VIEWER_STATE, data: state });
  return { sceneId };
}
