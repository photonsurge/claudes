/**
 * Client helpers for the director command queue (shared/director-commands.ts):
 * send an operator command, read the command log, drop a queued command.
 */
import type { DirectorCommand, DirectorOp } from "@photonsurge/shared/director-commands";

const base = (sceneId: string) => `/api/director/${encodeURIComponent(sceneId)}/commands`;

export type SendResult = { ok: true; command: DirectorCommand } | { ok: false; error: string };

/** Queue a command. A director that is off answers 409 with the refused row. */
export async function sendCommand(sceneId: string, op: DirectorOp): Promise<SendResult> {
  try {
    const res = await fetch(base(sceneId), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(op),
    });
    const body = (await res.json().catch(() => ({}))) as { command?: DirectorCommand; error?: string };
    if (res.ok && body.command) return { ok: true, command: body.command };
    return { ok: false, error: body.command?.note ?? body.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** The scene's command log, newest first. Empty on any failure. */
export async function fetchCommands(sceneId: string, limit = 20): Promise<DirectorCommand[]> {
  try {
    const res = await fetch(`${base(sceneId)}?limit=${limit}`, { cache: "no-store" });
    if (!res.ok) return [];
    const body = (await res.json()) as { commands?: DirectorCommand[] };
    return body.commands ?? [];
  } catch {
    return [];
  }
}

/** Drop one queued command. */
export async function dropCommand(sceneId: string, id: string): Promise<boolean> {
  try {
    const res = await fetch(`${base(sceneId)}/${encodeURIComponent(id)}`, { method: "DELETE" });
    return res.ok;
  } catch {
    return false;
  }
}
