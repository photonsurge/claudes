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

export interface Requester {
  author: string;
  platform: string;
  /** Camera requests they made. */
  asked: number;
  /** How many of those went to air. */
  aired: number;
}

/**
 * Who has been steering the director from chat: viewer camera requests in the
 * log, grouped per author, most aired first (then most asked, then name).
 */
export function topRequesters(log: readonly DirectorCommand[], limit = 5): Requester[] {
  const by = new Map<string, Requester>();
  for (const c of log) {
    if (c.source.kind !== "viewer" || (c.cmd.op !== "cut" && c.cmd.op !== "queue")) continue;
    const key = `${c.source.platform}:${c.source.author.toLowerCase()}`;
    const row = by.get(key) ?? { author: c.source.author, platform: c.source.platform, asked: 0, aired: 0 };
    row.asked++;
    if (c.status === "applied") row.aired++;
    by.set(key, row);
  }
  return [...by.values()]
    .sort((a, b) => b.aired - a.aired || b.asked - a.asked || a.author.localeCompare(b.author))
    .slice(0, limit);
}
