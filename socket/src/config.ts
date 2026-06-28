export const PORT = Number(process.env.PORT) || 4000;
export const SOCKET_PATH = process.env.SOCKET_PATH || "/socket.io/";

export const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);
