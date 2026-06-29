import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { BROADCAST_STATE_ID } from "@photonsurge/shared/db/broadcast-state-model";
import {
  DEFAULT_CONTROL_STATE,
  mergeControlState,
  MAIN_SCENE_ID,
  type ControlState,
} from "@photonsurge/shared/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** Strip a persisted scene doc down to a clean ControlState. */
function toControlState(doc: Partial<ControlState> | null | undefined): ControlState {
  return mergeControlState(DEFAULT_CONTROL_STATE, doc ?? {});
}

/** Resolve the scene doc for an id; the main scene self-seeds, others may be null. */
async function loadScene(db: Awaited<ReturnType<typeof getAppDb>>, id: string) {
  return id === MAIN_SCENE_ID ? await db.getOrInitBroadcastState() : await db.getScene(id);
}

/** GET /api/scenes/:id — the scene's ControlState (404 if missing). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const db = await getAppDb();
  const doc = await loadScene(db, id);
  if (!doc) {
    return NextResponse.json({ error: "no such scene" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json(toControlState(doc), { status: 200, headers: NO_CACHE });
}

/** PATCH /api/scenes/:id — merge a control patch onto the scene, persist, return. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let patch: Partial<ControlState> = {};
  try {
    patch = (await req.json()) ?? {};
  } catch {
    /* empty patch is a no-op merge */
  }

  const db = await getAppDb();
  const existing = await loadScene(db, id);
  if (!existing) {
    return NextResponse.json({ error: "no such scene" }, { status: 404, headers: NO_CACHE });
  }
  const merged = toControlState(mergeControlState(toControlState(existing), patch));
  // Preserve the scene name (not part of ControlState) across the merge.
  const name = (existing as { name?: string }).name;
  await db.broadcastState.upsertByID(id, { ...merged, ...(name ? { name } : {}) } as never);
  return NextResponse.json(merged, { status: 200, headers: NO_CACHE });
}

/** DELETE /api/scenes/:id — remove a named scene (the main scene is protected). */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === MAIN_SCENE_ID || id === BROADCAST_STATE_ID) {
    return NextResponse.json({ error: "the main scene cannot be deleted" }, { status: 400, headers: NO_CACHE });
  }
  const db = await getAppDb();
  const ok = await db.deleteScene(id);
  if (!ok) {
    return NextResponse.json({ error: "no such scene" }, { status: 404, headers: NO_CACHE });
  }
  return NextResponse.json({ ok: true, id }, { status: 200, headers: NO_CACHE });
}
