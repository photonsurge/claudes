// socket.ts
// The worker's Socket.IO *client* to the socket server. Connects as actorType
// "worker" with a short-lived JWT (regenerated before every (re)connect), and
// exposes `emitWorkerEvent` — the one way job handlers push events (e.g.
// "weather:run", "ping:done") up to the relay, which fans them out to browsers.
import { io } from "socket.io-client";
import { generateShortLivedJwt } from "@photonsurge/shared/utill/jwt";
import { log } from "@photonsurge/shared/utill/logger";
import type { TARGET_TYPE } from "@photonsurge/shared/index";

export interface WorkerEventPayload {
  type: string; // e.g. "ping:done"
  jobId?: string;
  source?: string;
  targetID?: string;
  targetType?: TARGET_TYPE;
  data?: unknown;
  createdAt?: string;
}

export let socket: ReturnType<typeof io>;

const TAG = "socket-client";
const ACTOR_TYPE = "worker";

const freshAuth = async (): Promise<{ token: string; actorType: string }> => ({
  token: await generateShortLivedJwt(
    { actorType: ACTOR_TYPE, sub: "worker" },
    "5min",
    process.env.WORKER_AUTH_SECRET,
  ),
  actorType: ACTOR_TYPE,
});

export async function initSocket() {
  const SOCKET_URL = process.env.SOCKET_URL || "http://localhost:4000";
  log(TAG, `initSocket()`, SOCKET_URL);

  socket = io(SOCKET_URL, {
    transports: ["websocket"],
    // callback form — JWT is regenerated before every (re)connection attempt
    auth: (cb) => {
      freshAuth().then(cb).catch(() => cb({ token: "", actorType: ACTOR_TYPE }));
    },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 2_000,
    reconnectionDelayMax: 30_000,
  });

  socket.on("connect", () => log(TAG, `connected`, socket.id));
  socket.on("disconnect", (reason) => {
    log(TAG, `disconnected`, reason);
    if (reason === "io server disconnect") socket.connect();
  });
  socket.on("connect_error", (err) => log(TAG, `connect_error`, err.message));

  return socket;
}

/** Emit a worker event up to the socket server, which fans it out to clients. */
export function emitWorkerEvent(payload: WorkerEventPayload) {
  const event = { createdAt: new Date().toISOString(), ...payload };
  if (!socket?.connected) {
    log(TAG, `emit dropped (not connected)`, payload.type);
    return;
  }
  socket.emit("worker:event", event);
}

export function closeSocket() {
  socket?.disconnect();
}
