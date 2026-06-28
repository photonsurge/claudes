import type { ActorType } from "../types";

/**
 * Pure relay policy helpers — kept separate from the socket wiring so they can
 * be unit-tested without a live io server.
 */

/** Only worker/service actors may fan `worker:event` out to the public room. */
export const canRelayWorkerEvent = (actorType: ActorType): boolean =>
  actorType === "worker" || actorType === "service";

/**
 * Operator → watchers relay: a browser ("user") drives the /watch broadcast by
 * emitting `control:state`. Phase 1 allows any authenticated user; an explicit
 * operator scope/role is later hardening.
 */
export const canRelayControlState = (actorType: ActorType): boolean => actorType === "user";

/** Resolve the broadcast event name from a worker payload. */
export const resolveWorkerEventName = (payload: { type?: unknown }): string =>
  typeof payload?.type === "string" ? payload.type : "worker:event";
