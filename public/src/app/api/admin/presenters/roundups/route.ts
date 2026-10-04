import { withApiLog } from "../../../../../lib/api-log";
import { NextResponse } from "next/server";
import { getAppDb } from "@photonsurge/shared/db/index";
import { roundupSpeechText } from "@photonsurge/shared/presenter";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_CACHE = { "Cache-Control": "no-store" };
const PERIOD_LABEL: Record<string, string> = { hourly: "hourly", "12h": "12-hour", daily: "daily" };

export interface RoundupPick {
  key: string;
  group: "World" | "Countries" | "Regions";
  label: string;
  generatedAt: string;
  /** Exactly what the presenter reads (plan §7): global narrative, or place summary + state of play. */
  text: string;
}

const stamp = (d: Date | string) => new Date(d).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/**
 * GET /api/admin/presenters/roundups — round-ups to read on the voice bench:
 * the recent world (global) round-ups, and the latest round-up per country and
 * per region. Ones with no text (skipped or failed) are left out.
 */
async function GET__impl() {
  const db = await getAppDb();
  const [world, countries, regions] = await Promise.all([
    db.eventSummaries.list({ limit: 15 }),
    db.countryRoundups.latestPerPlace(),
    db.regionRoundups.latestPerPlace(),
  ]);

  const items: RoundupPick[] = [];
  for (const s of world) {
    const text = roundupSpeechText(s);
    if (text) {
      items.push({
        key: `world:${s.id}`,
        group: "World",
        label: `World ${PERIOD_LABEL[s.period] ?? s.period} · ${stamp(s.generatedAt)}`,
        generatedAt: new Date(s.generatedAt).toISOString(),
        text,
      });
    }
  }
  for (const [group, list] of [
    ["Countries", countries],
    ["Regions", regions],
  ] as const) {
    for (const r of list) {
      const text = roundupSpeechText(r);
      if (text) {
        items.push({
          key: `${r.placeKind}:${r.placeId}:${r.id}`,
          group,
          label: `${r.name} · ${stamp(r.generatedAt)}`,
          generatedAt: new Date(r.generatedAt).toISOString(),
          text,
        });
      }
    }
  }
  return NextResponse.json({ items }, { status: 200, headers: NO_CACHE });
}

// --- request logging (lib/api-log) ---
export const GET = withApiLog(GET__impl);
