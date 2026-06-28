import type { Server } from "socket.io";
import type { SocketWithContext } from "../types";
import { PUBLIC_ROOM } from "../rooms";
import { log, warn } from "../utils";

/**
 * Wire all event handlers for a connected socket.
 *
 * The one sample flow: the worker connects as actorType "worker" and emits
 * `worker:event`. We fan those out to every browser in the PUBLIC_ROOM under
 * the event name carried in `payload.type` (e.g. "ping:done").
 */
export function registerHandlers(io: Server, socket: SocketWithContext) {
  const ctx = socket.data.context!;

  // Service → clients relay. Only worker/service actors may emit these.
  socket.on("worker:event", (payload: { type?: string; data?: unknown } & Record<string, unknown>) => {
    if (ctx.actorType !== "worker" && ctx.actorType !== "service") {
      warn("relay.denied", { socketId: socket.id, actorType: ctx.actorType });
      return;
    }
    const type = typeof payload?.type === "string" ? payload.type : "worker:event";
    log("relay.worker:event", { type, from: ctx.actorId });
    io.to(PUBLIC_ROOM).emit(type, payload);
  });

  // Simple round-trip used by clients to confirm the socket is alive.
  socket.on("client:hello", (_payload, ack?: (r: unknown) => void) => {
    if (typeof ack === "function") ack({ ok: true, actorType: ctx.actorType });
  });
}
