/**
 * Socket server runtime config read from the environment: the listen PORT, the
 * Socket.IO mount path, and the CORS ALLOWED_ORIGINS allow-list (comma-separated
 * in env). Centralised so index.ts/bootstrap.ts share one source of truth.
 */
export const PORT = Number(process.env.PORT) || 4000;
export const SOCKET_PATH = process.env.SOCKET_PATH || "/socket.io/";

export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
