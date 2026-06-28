/**
 * Per-socket event handler registration — the heart of the relay. Wires the two
 * fan-out relays into the PUBLIC_ROOM (worker `worker:event` and operator
 * `control:state`) plus a `client:hello` liveness ack. Relay authorization is
 * delegated to the pure policy helpers in ./relay.
 */
import type { Server } from "socket.io";
import type { SocketWithContext } from "../types";
import { PUBLIC_ROOM } from "../rooms";
import { log, warn } from "../utils";
import { CONTROL_STATE } from "@photonsurge/shared/control";
import { canRelayControlState, canRelayWorkerEvent, resolveWorkerEventName } from "./relay";

/**
 * Wire all event handlers for a connected socket.
 *
 * Two relays into the PUBLIC_ROOM (every browser):
 *  - the worker connects as actorType "worker" and emits `worker:event`; we fan
 *    those out under the event name carried in `payload.type` (e.g. "ping:done",
 *    "weather:run").
 *  - the operator (/control, a "user") emits `control:state`; we fan that out to
 *    every /watch browser so the broadcast follows the operator live.
 */
export function registerHandlers(io: Server, socket: SocketWithContext) {
  const ctx = socket.data.context!;

  // Service → clients relay. Only worker/service actors may emit these.
  socket.on("worker:event", (payload: { type?: string; data?: unknown } & Record<string, unknown>) => {
    if (!canRelayWorkerEvent(ctx.actorType)) {
      warn("relay.denied", { socketId: socket.id, actorType: ctx.actorType });
      return;
    }
    const type = resolveWorkerEventName(payload);
    log("relay.worker:event", { type, from: ctx.actorId });
    io.to(PUBLIC_ROOM).emit(type, payload);
  });

  // Operator → watchers relay. Only authenticated browsers may drive /watch.
  socket.on(CONTROL_STATE, (payload: Record<string, unknown>) => {
    if (!canRelayControlState(ctx.actorType)) {
      warn("relay.denied", { socketId: socket.id, actorType: ctx.actorType, event: CONTROL_STATE });
      return;
    }
    log("relay.control:state", { from: ctx.actorId });
    io.to(PUBLIC_ROOM).emit(CONTROL_STATE, payload);
  });

  // Simple round-trip used by clients to confirm the socket is alive.
  socket.on("client:hello", (_payload, ack?: (r: unknown) => void) => {
    if (typeof ack === "function") ack({ ok: true, actorType: ctx.actorType });
  });
}
