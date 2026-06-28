/**
 * Socket.IO room-name helpers. `PUBLIC_ROOM` is the broadcast room every browser
 * joins (where worker events and operator control:state are fanned out);
 * `roomForUser`/`roomForActor` build the per-user / per-actor room names used for
 * targeted delivery.
 */
import type { ActorType } from "./types";

/** Broadcast room every browser/user joins — used to fan out public events. */
export const PUBLIC_ROOM = "public";

export function roomForUser(userId: string): string {
  return `user:${userId}`;
}

export function roomForActor(actorType: ActorType, actorId: string): string {
  return `actor:${actorType}:${actorId}`;
}
