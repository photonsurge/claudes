import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { getQueue } from "@photonsurge/shared/bull/bull";
import { vehicleId, type VehicleKind } from "@photonsurge/shared/db/vehicle-model";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const KINDS: VehicleKind[] = ["aircraft", "ship"];
const clean = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() ? v.trim() : undefined;

/**
 * GET /api/admin/notable — the notable vehicles (the curated subset of the
 * registry), newest first. The live aircraft/ship tables read this to mark which
 * rows are already catalogued.
 */
export async function GET() {
  try {
    const db = await getAppDb();
    const notable = await db.vehicles.list({ notable: true, limit: 0, sort: { updated: -1 } });
    return NextResponse.json({ notable }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err), notable: [] }, { status: 502, headers: NO_CACHE });
  }
}

/**
 * POST /api/admin/notable { kind, code, label?, wikiTitle?, category?, vip? }
 * Flag a craft as notable in the registry (creating the vehicle doc if it's never
 * been seen) and enqueue a TARGETED enrichment so its photo/blurb fill within
 * seconds — the button on the live aircraft/ship tables. Re-posting edits it.
 */
export async function POST(req: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await req.json()) ?? {};
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400, headers: NO_CACHE });
  }

  const kind = body.kind as VehicleKind;
  const code = clean(body.code)?.toLowerCase();
  if (!KINDS.includes(kind) || !code) {
    return NextResponse.json(
      { error: "kind (aircraft|ship) and code are required" },
      { status: 400, headers: NO_CACHE },
    );
  }

  const hasLabel = !!clean(body.label);
  const label = clean(body.label) || code.toUpperCase();
  const id = vehicleId(kind, code);
  // Default the wiki title to the label (famous named craft ARE their article
  // title) so ships get a photo/blurb; aircraft also get a planespotters photo.
  const wikiTitle = clean(body.wikiTitle) || (hasLabel ? label : undefined);

  try {
    const db = await getAppDb();
    const saved = await db.vehicles.upsertCurated({
      kind,
      code,
      label,
      wikiTitle,
      category: clean(body.category),
      vip: body.vip === true ? true : undefined,
      notable: true,
      enabled: true,
    });
    try {
      await getQueue().add(
        "do",
        { domain: "notable", type: "notable", event: "enrichNotable", data: { ids: [id] } },
        { removeOnComplete: true, removeOnFail: true, priority: 5 },
      );
    } catch {
      /* queued enrichment is best-effort — the repeatable will catch it */
    }
    return NextResponse.json({ notable: saved, queued: true }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}

/**
 * DELETE /api/admin/notable?id=ship:310627000 — un-flag a craft (clears notable/
 * enabled). The registry doc + its sighting history are kept, just no longer
 * boosted on air.
 */
export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "missing id" }, { status: 400, headers: NO_CACHE });
  try {
    const db = await getAppDb();
    await db.vehicles.patch(id, { notable: false, enabled: false });
    return NextResponse.json({ ok: true, id }, { status: 200, headers: NO_CACHE });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 502, headers: NO_CACHE });
  }
}
