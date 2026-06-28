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
