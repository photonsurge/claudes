import { withApiLog } from "../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };

type Db = Awaited<ReturnType<typeof getAppDb>>;

export interface SampleText {
  label: string;
  text: string;
}

/**
 * Sample text for the bench: the words a presenter will actually read first
 * (docs/presenter-plan.md §7). The latest global round-ups, and the latest
 * place round-up's summary and state of play.
 */
async function samples(db: Db): Promise<SampleText[]> {
  const out: SampleText[] = [];
  const [hourly, daily, countries, regions] = await Promise.all([
    db.eventSummaries.latest("hourly"),
    db.eventSummaries.latest("daily"),
    db.countryRoundups.generatedSince(Date.now() - 48 * 3_600_000, { limit: 1 }),
    db.regionRoundups.generatedSince(Date.now() - 48 * 3_600_000, { limit: 1 }),
  ]);
  if (hourly?.narrative) out.push({ label: "Latest hourly round-up", text: hourly.narrative });
  if (daily?.narrative) out.push({ label: "Latest daily round-up", text: daily.narrative });
  for (const r of [...countries, ...regions]) {
    const text = [r.summary, r.stateOfPlay].filter(Boolean).join("\n\n");
    if (text) out.push({ label: `${r.name} round-up (summary + state of play)`, text });
  }
  out.push({
    label: "Units and numbers",
    text: "A magnitude M5.6 quake struck at 03:12 UTC, 10 km deep. Gusts reach 120 km/h, with 50–80 mm of rain and a low of -3 °C.",
  });
  return out;
}

/**
 * GET /api/admin/presenters — everything the presenter page needs: the
 * catalog, the master switch, the cached speech models and sample text.
 * (Admin-gated by proxy.ts's `/api/admin/*` matcher.)
 */
async function GET__impl() {
  const db = await getAppDb();
  const [presenters, settings, catalog, sampleTexts] = await Promise.all([
    db.presenters.list(),
    db.presenterSettings.get(),
    db.speechCatalog.get(),
    samples(db).catch(() => [] as SampleText[]),
  ]);
  return NextResponse.json(
    { presenters, settings, catalog, samples: sampleTexts },
    { status: 200, headers: NO_CACHE },
  );
}

/** PUT /api/admin/presenters — body `{ presenter }`. Creates or updates by id (or the name's slug). */
async function PUT__impl(req: Request) {
  const body = (await req.json().catch(() => null)) as { presenter?: unknown } | null;
  const db = await getAppDb();
  const saved = body?.presenter ? await db.presenters.save(body.presenter) : null;
  if (!saved) {
    return NextResponse.json({ ok: false, error: "presenter with a name required" }, { status: 400, headers: NO_CACHE });
  }
  return NextResponse.json({ ok: true, presenter: saved }, { status: 200, headers: NO_CACHE });
}

/** DELETE /api/admin/presenters?id=… — removes a presenter. Its takes stay until pruned. */
async function DELETE__impl(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400, headers: NO_CACHE });
  const db = await getAppDb();
  const ok = await db.presenters.delete(id);
  return NextResponse.json({ ok }, { status: ok ? 200 : 404, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
export const PUT = withApiLog(PUT__impl);
export const DELETE = withApiLog(DELETE__impl);
