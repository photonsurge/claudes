import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { BROADCAST_STATE_ID } from "@photonsurge/shared/db/broadcast-state-model";
import {
  DEFAULT_CONTROL_STATE,
  mergeControlState,
  type ControlState,
} from "@photonsurge/shared/control";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

/** Extract just the ControlState fields from a persisted broadcast doc. */
function toControlState(doc: Partial<ControlState> | null | undefined): ControlState {
  return mergeControlState(DEFAULT_CONTROL_STATE, doc ?? {});
}

/** GET /api/broadcast/state — the singleton operator state (seeded). */
export async function GET() {
  const db = await getAppDb();
  const doc = await db.getOrInitBroadcastState();
  return NextResponse.json(toControlState(doc), { status: 200, headers: NO_CACHE });
}

/** PATCH /api/broadcast/state — merge a patch onto current, persist, return. */
export async function PATCH(req: Request) {
  let patch: Partial<ControlState> = {};
  try {
    patch = (await req.json()) ?? {};
  } catch {
    /* empty patch is a no-op merge */
  }

  const db = await getAppDb();
  const current = toControlState(await db.getOrInitBroadcastState());
  const merged = mergeControlState(current, patch);
  await db.broadcastState.upsertByID(BROADCAST_STATE_ID, merged);
  return NextResponse.json(merged, { status: 200, headers: NO_CACHE });
}
