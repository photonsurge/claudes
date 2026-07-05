/**
 * Socket handshake authentication. `authenticateSocket` is called from the
 * Socket.IO `io.use` middleware (index.ts): it reads `{ token, actorType }` off
 * the handshake, verifies the JWT against the right secret per actor type, and
 * returns an AuthResult carrying the ActorContext (roles/scopes) used downstream
 * for relay authorization and room membership.
 */
import type { Socket } from "socket.io";
import type { ActorType, AuthResult } from "./types";
import { getSocketIp, log, warn } from "./utils";
import { validateJwt } from "@photonsurge/shared/utill/jwt";

const VERBOSE = process.env.SOCKET_VERBOSE === "true";

const fail = (reason: string, extra?: Record<string, unknown>): AuthResult => {
  warn("auth.rejected", { reason, ...extra });
  return { ok: false, reason };
};

/**
 * Authenticate a socket handshake. Two actor types:
 *  - "worker"  service tokens signed with WORKER_AUTH_SECRET
 *  - "user"    browser tokens signed with SOCKET_TOKEN_SECRET
 */
export async function authenticateSocket(socket: Socket): Promise<AuthResult> {
  const ip = getSocketIp(socket);
  const auth = socket.handshake.auth || {};
  const token = auth.token as string | undefined;
  const actorType = auth.actorType as ActorType | undefined;

  if (VERBOSE) log("auth.attempt", { socketId: socket.id, ip, actorType, hasToken: !!token });

  if (!token) return fail("Missing token", { ip, actorType });
  if (!actorType) return fail("Missing actorType", { ip });

  if (actorType === "worker") {
    try {
      const v = validateJwt(token, process.env.WORKER_AUTH_SECRET);
      if (v.actorType !== "worker") return fail("Token actorType mismatch", { ip, got: v.actorType });
      return {
        ok: true,
        context: {
          actorType: "worker",
          actorId: v.sub || socket.id,
          sessionId: socket.id,
          roles: ["service"],
          scopes: ["worker:emit"],
          ip,
        },
      };
    } catch (err) {
      return fail("Invalid worker token", { ip, err: String(err) });
    }
  }

  if (actorType === "user") {
    try {
      const v = validateJwt(token, process.env.SOCKET_TOKEN_SECRET);
      const userId = v.sub || "";
      const role = v.role;
      return {
        ok: true,
        context: {
          actorType: "user",
          actorId: userId ? `user-${userId}` : `guest-${socket.id}`,
          ...(userId ? { userId } : {}),
          sessionId: socket.id,
          roles: role ? ["user", role] : ["user"],
          scopes: role === "admin" ? ["public:receive", "control:emit"] : ["public:receive"],
          ip,
        },
      };
    } catch (err) {
      return fail("Invalid user token", { ip, err: String(err) });
    }
  }

  return fail("Unknown actorType", { ip, actorType });
}
