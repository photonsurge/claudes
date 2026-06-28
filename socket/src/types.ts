/**
 * Shared types for the socket server. `ActorType` and `ActorContext` describe a
 * connection's identity/roles/scopes (produced by auth.ts, attached to
 * `socket.data.context`); `AuthResult` is the handshake outcome; and
 * `SocketWithContext` is the Socket variant carrying that context.
 */
import type { Socket } from "socket.io";

export type ActorType = "user" | "worker" | "service";

export type ActorContext = {
  actorType: ActorType;
  actorId: string;
  userId?: string;
  sessionId?: string;
  roles?: string[];
  scopes?: string[];
  ip: string;
};

export type AuthResult =
  | { ok: true; context: ActorContext }
  | { ok: false; reason: string };

export type SocketWithContext = Socket & {
  data: {
    context?: ActorContext;
  };
};
