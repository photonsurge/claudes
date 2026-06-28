import type { Socket } from "socket.io";

export function nowIso(): string {
  return new Date().toISOString();
}

export function log(event: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: nowIso(), event, ...meta }));
}

export function logInfo(event: string, meta: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ ts: nowIso(), level: "info", event, ...meta }));
}

export function warn(event: string, meta: Record<string, unknown> = {}) {
  console.warn(JSON.stringify({ ts: nowIso(), level: "warn", event, ...meta }));
}

export function logError(event: string, meta: Record<string, unknown> = {}) {
  console.error(JSON.stringify({ ts: nowIso(), level: "error", event, ...meta }));
}

export function getSocketIp(socket: Socket): string {
  const handshake = socket.handshake;
  if (!handshake) return "unknown";

  const xff = handshake.headers?.["x-forwarded-for"];
  if (typeof xff === "string") {
    const first = xff.split(",").map((s) => s.trim()).find(Boolean);
    if (first) return first;
  }
  if (Array.isArray(xff)) {
    const first = xff.map((s) => s.trim()).find(Boolean);
    if (first) return first;
  }

  return handshake.address ?? "unknown";
}
