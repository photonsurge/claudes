import http from "http";
import type { Server } from "socket.io";
import packageJson from "../package.json";
import { PORT } from "./config";
import { registerHandlers } from "./handlers";
import { registerSocket, unregisterSocket, connectedCount } from "./registry";
import { PUBLIC_ROOM, roomForActor, roomForUser } from "./rooms";
import type { ActorContext, SocketWithContext } from "./types";
import { log, logError } from "./utils";

export function summarizeError(error: unknown) {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  if (typeof error === "object" && error !== null) {
    return JSON.parse(JSON.stringify(error));
  }
  return String(error);
}

export function logSocketError(message: string, error: unknown, extra: Record<string, unknown> = {}) {
  logError(message, { error: summarizeError(error), ...extra });
}

/**
 * Per-connection wiring: register the socket, join its rooms, emit
 * `session:ready`, attach handlers, and clean up on disconnect.
 */
export function handleConnection(io: Server, socket: SocketWithContext) {
  const ctx = socket.data.context as ActorContext | undefined;

  if (!ctx) {
    logError("socket.missing-context", { socketId: socket.id });
    socket.emit("session:error", { message: "Missing socket context" });
    socket.disconnect(true);
    return;
  }

  log("socket.connected", { socketId: socket.id, actorType: ctx.actorType, actorId: ctx.actorId });

  registerSocket(socket.id, ctx);
  socket.join(roomForActor(ctx.actorType, ctx.actorId));
  if (ctx.userId) socket.join(roomForUser(ctx.userId));

  // Browsers/users join the public broadcast room so worker events reach them.
  if (ctx.actorType === "user") socket.join(PUBLIC_ROOM);

  socket.emit("session:ready", { actorType: ctx.actorType, actorId: ctx.actorId, userId: ctx.userId });

  registerHandlers(io, socket);

  socket.on("disconnect", (reason) => {
    log("socket.disconnected", { socketId: socket.id, actorId: ctx.actorId, reason });
    unregisterSocket(socket.id);
  });

  socket.on("error", (error) => {
    logSocketError("socket connection error", error, { socketId: socket.id, actorId: ctx.actorId });
  });
}

/** Plain-HTTP service endpoints: /healthz, /status, /version. */
export function createHttpRequestHandler(getIo: () => Server | undefined) {
  return (req: http.IncomingMessage, res: http.ServerResponse) => {
    const io = getIo();

    if (req.method === "GET" && req.url === "/healthz") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }

    if (req.method === "GET" && req.url === "/status") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", connected: io ? connectedCount() : 0, time: new Date().toISOString() }));
      return;
    }

    if (req.method === "GET" && req.url === "/version") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ name: packageJson.name, version: packageJson.version, port: PORT }));
      return;
    }

    res.writeHead(404);
    res.end();
  };
}
