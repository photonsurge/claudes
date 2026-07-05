import type { ActorContext, ActorType } from "../types";

/**
 * Pure relay policy helpers — kept separate from the socket wiring so they can
 * be unit-tested without a live io server.
 */

/** Only worker/service actors may fan `worker:event` out to the public room. */
export const canRelayWorkerEvent = (actorType: ActorType): boolean =>
  actorType === "worker" || actorType === "service";

/**
 * Operator → watchers relay: an admin browser drives the /watch broadcast by
 * emitting `control:state`. Every connected browser is `actorType === "user"`
 * (including anonymous /watch viewers), so authorization hinges on whether the
 * actor's token carried an admin role/scope — not on actorType alone.
 */
export const canRelayControlState = (ctx: Pick<ActorContext, "actorType" | "roles" | "scopes">): boolean =>
  ctx.actorType === "user" && (ctx.roles?.includes("admin") || ctx.scopes?.includes("control:emit") || false);

/** Resolve the broadcast event name from a worker payload. */
export const resolveWorkerEventName = (payload: { type?: unknown }): string =>
  typeof payload?.type === "string" ? payload.type : "worker:event";
