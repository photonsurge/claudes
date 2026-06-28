import type { ActorType } from "./types";

/** Broadcast room every browser/user joins — used to fan out public events. */
export const PUBLIC_ROOM = "public";

export function roomForUser(userId: string): string {
  return `user:${userId}`;
}

export function roomForActor(actorType: ActorType, actorId: string): string {
  return `actor:${actorType}:${actorId}`;
}
