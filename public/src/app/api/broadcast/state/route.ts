import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getAppDb } from "@photonsurge/shared/db/index";
import { BROADCAST_STATE_ID } from "@photonsurge/shared/db/broadcast-state-model";
import { SESSION_COOKIE, readSession, isAdmin } from "@photonsurge/shared/utill/session";
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

/**
 * GET /api/broadcast/state?token=... — the singleton operator state (seeded).
 * /watch (the bare main-scene OBS output, can't log in) authorizes via `token`
 * matching the doc's watchToken; the admin session cookie also works.
 */
export async function GET(req: Request) {
  const db = await getAppDb();
  const doc = await db.getOrInitBroadcastState();

  const sessionToken = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = sessionToken ? readSession(sessionToken) : null;
  const tokenParam = new URL(req.url).searchParams.get("token");
  const watchToken = (doc as { watchToken?: string }).watchToken;
  if (!isAdmin(session) && (!watchToken || tokenParam !== watchToken)) {
    return NextResponse.json({ error: "missing or invalid watch token" }, { status: 401, headers: NO_CACHE });
  }

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
