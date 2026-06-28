/**
 * Socket server entrypoint. Boots the HTTP server + Socket.IO, authenticates
 * every handshake via `io.use` (auth.ts), wires per-connection handlers
 * (bootstrap.ts → handlers/), and listens on PORT. This is the realtime relay:
 * it fans worker events and operator control:state out to browsers. Loads env
 * first (must run before any config import that reads process.env).
 */
import { loadEnv } from "./loadEnv";
loadEnv();

import { Server } from "socket.io";
import http from "http";
import packageJson from "../package.json";
import { authenticateSocket } from "./auth";
import { ALLOWED_ORIGINS, PORT, SOCKET_PATH } from "./config";
import { createHttpRequestHandler, handleConnection, logSocketError } from "./bootstrap";
import type { SocketWithContext } from "./types";
import { log, logInfo, warn } from "./utils";

const TAG = "socket-index";
const VERBOSE = process.env.SOCKET_VERBOSE === "true";

let io: Server | undefined;

const httpServer = http.createServer(createHttpRequestHandler(() => io));

io = new Server(httpServer, {
  path: SOCKET_PATH,
  cors: {
    origin: (origin, callback) => callback(null, !origin || ALLOWED_ORIGINS.includes(origin)),
    methods: ["GET", "POST"],
    credentials: true,
  },
});

io.use(async (socket, next) => {
  if (VERBOSE) log("socket.handshake", { socketId: socket.id, actorType: socket.handshake.auth?.actorType });

  const authResult = await authenticateSocket(socket);
  if (!authResult.ok) {
    warn("socket.auth.failed", { socketId: socket.id, reason: authResult.reason });
    return next(new Error(authResult.reason));
  }

  socket.data.context = authResult.context;
  return next();
});

io.engine.on("connection_error", (error: any) => {
  logSocketError("engine connection error", error, { code: error?.code, message: error?.message });
});

io.on("connection", (socket) => {
  handleConnection(io!, socket as SocketWithContext);
});

httpServer.on("error", (error) => logSocketError("http server error", error, { port: PORT }));

httpServer.listen(PORT, () => {
  console.log(`\n🟢 SOCKET SERVER LISTENING ON PORT ${PORT}\n`);
  logInfo("socket server started", { tag: TAG, port: PORT, path: SOCKET_PATH, allowedOrigins: ALLOWED_ORIGINS, version: packageJson.version });
});

process.on("unhandledRejection", (reason) => logSocketError("unhandled rejection", reason));
process.on("uncaughtException", (error) => {
  logSocketError("uncaught exception", error);
  setTimeout(() => process.exit(1), 50);
});
