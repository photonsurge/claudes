import type { ActorContext } from "./types";

type RegisteredSocket = {
  socketId: string;
  actorType: string;
  actorId: string;
  userId?: string;
};

const socketsById = new Map<string, RegisteredSocket>();
const socketsByUser = new Map<string, Set<string>>();

export function registerSocket(socketId: string, ctx: ActorContext) {
  unregisterSocket(socketId);

  socketsById.set(socketId, {
    socketId,
    actorType: ctx.actorType,
    actorId: ctx.actorId,
    ...(ctx.userId !== undefined ? { userId: ctx.userId } : {}),
  });

  if (ctx.userId !== undefined) {
    const set = socketsByUser.get(ctx.userId) ?? new Set<string>();
    set.add(socketId);
    socketsByUser.set(ctx.userId, set);
  }
}

export function unregisterSocket(socketId: string) {
  const existing = socketsById.get(socketId);
  if (!existing) return;

  if (existing.userId) {
    const set = socketsByUser.get(existing.userId);
    if (set) {
      set.delete(socketId);
      if (set.size === 0) socketsByUser.delete(existing.userId);
    }
  }

  socketsById.delete(socketId);
}

export function getConnectedUserSocketIds(userId: string): string[] {
  return Array.from(socketsByUser.get(userId) || []);
}

export function connectedCount(): number {
  return socketsById.size;
}
