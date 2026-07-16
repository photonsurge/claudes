import type { AppDb } from "@photonsurge/shared/db/index";
import { log } from "@photonsurge/shared/utill/logger";
import {
  fetchCountryPage,
  fetchPages,
  freshPages,
  windowFor,
  meteogateCountries,
  resolveFeature,
  quota,
  quotaLow,
  RateLimitError,
  type EdrFeature,
  type EdrWindow,
} from "./meteogate";
import type { CrawlCursor } from "@photonsurge/shared/db/alert-area-geom-repo";
import { repairCachedGeometry } from "./repair";

const TAG = "alerts:geom-sync";

/**
 * Gateway requests one run may spend on pages.
 *
 * Pages are the ONLY thing that costs quota. Resolving a feature does not: the
 * rel=json and rel=geometry links are pre-signed object-store URLs, and measured
 * live, 80 features (160 link fetches) moved the counter by zero while 42 page
 * fetches moved it 42. The old code's "resolving one alert costs two requests"
 * was simply wrong, and it was why the page walk was rationed to nothing.
 *
 * The sweep is hourly and the quota is 500/hour, so 400 leaves a comfortable
 * reserve for a concurrent `yarn refresh:alert-geom`.
 */
const PAGE_BUDGET = () => Number(process.env.METEOGATE_PAGE_BUDGET || 400);

/**
 * How long a completed crawl stands before the middle is walked again.
 *
 * A finished crawl has seen every page of its window, so re-walking it buys
 * nothing until enough time has passed for warnings to have appeared over areas
 * that had none. Areas are permanent; this only has to be faster than Europe
 * gains new EMMA codes.
 */
const RECRAWL_MS = () => Number(process.env.METEOGATE_RECRAWL_MS || 7 * 24 * 60 * 60 * 1000);

export interface GeomSyncResult {
  /** Countries swept without error. */
  countries: number;
  /** EDR features seen across all countries. */
  features: number;
  /** Alerts we actually resolved (each costs two requests). */
  resolved: number;
  /** EMMA areas written (new boundary or a bbox→exact upgrade). */
  cached: number;
  /** Alerts skipped because the ledger had already resolved them. */
  skipped: number;
  /** Pages read by the deep crawl — the middle of the feed nothing used to read. */
  crawlPages: number;
  /** Countries whose crawl finished this run (every page of its window seen). */
  crawlsCompleted: number;
  /** Already-stored alerts retro-fitted with a boundary this run. */
  backfilled: number;
  /**
   * Alerts fixed by the reconcile — cached boundary, no shape, missed first time.
   * Steady state is 0; anything else is a backfill that didn't take.
   */
  reconciled: number;
  /** Cached boundaries Mongo would have refused, fixed in place (no re-fetch). */
  repaired: number;
  /** True when the run ended early on the quota rather than finishing. */
  quotaStopped: boolean;
  /** Gateway requests left in the window, as the server last reported them. */
  quotaRemaining: number | null;
  /**
   * What we can actually DRAW once the run is done — the only number that says
   * whether any of this is working. See alerts-repo#geometryCoverage.
   */
  coverage: {
    alerts: number;
    alertsNoShape: number;
    alertsPartial: number;
    areas: number;
    areasNoGeom: number;
  } | null;
  failures: string[];
}

/**
 * Apply cached boundaries to any active alert still missing one — not just the
 * areas resolved on this run.
 *
 * The backfill below is fired exactly once per area, on the run that resolves it.
 * If that single attempt doesn't take — a restart mid-run, a sibling polygon that
 * makes Mongo reject the `updateMany`, a transient error caught and logged — the
 * area is never revisited: ingest won't rewrite an unchanged active alert, and a
 * CAP message's `sent` never moves, so the alert stays shapeless until it expires.
 *
 * Measured live, that was not theoretical: 254 areas across 34 EMMA_IDs had an
 * EXACT boundary sitting in the cache and no shape on the alert. ES075's boundary
 * was cached at 17:19, its alerts had been stored at 15:58, and the retro-fit that
 * should have joined them ran and left them empty. Calling the same backfill by
 * hand three days later fixed all 22 first time — nothing was wrong with it except
 * that it only ever got one go.
 *
 * So: one lean scan for who still needs a shape, intersected with what we already
 * hold. Costs no MeteoGate quota (the boundaries are here), and in the steady
 * state the intersection is empty and it writes nothing — the alerts that need
 * something are the ones we haven't fetched yet, and those aren't in the cache to
 * apply.
 */
export async function reconcileCachedGeometry(
  db: AppDb,
  res: Pick<GeomSyncResult, "reconciled" | "failures">,
): Promise<void> {
  const wanted = await db.alerts.emmaIdsMissingGeometry();
  if (!wanted.length) return;

  const cached = await db.alertAreaGeom.byEmmaIds(wanted);
  if (!cached.size) return; // everything outstanding is still un-fetched — quota's problem, not ours

  for (const [emmaId, hit] of cached) {
    try {
      res.reconciled += await db.alerts.backfillAreaGeometry(emmaId, hit.geometry);
    } catch (err) {
      // Same reason as the backfill loop: one bad polygon must not cost the rest.
      res.failures.push(`reconcile ${emmaId}: ${String((err as Error)?.message ?? err)}`);
    }
  }
  if (res.reconciled) {
    log(TAG, `reconciled cached boundaries onto stored alerts`, {
      areas: cached.size,
      alerts: res.reconciled,
    });
  }
}

/**
 * Interleave one country's alerts with the next so a budget spreads across
 * Europe instead of draining into whichever country sorts first.
 *
 * This is not cosmetic. The countries are swept alphabetically, and Austria
 * alone offered 450 alerts, so the first run resolved Austria and nothing else —
 * Poland and the UK were never reached at all. Round-robin makes every country
 * progress on every run.
 */
export function interleaveByCountry(byCountry: Map<string, EdrFeature[]>): EdrFeature[] {
  const queues = [...byCountry.values()];
  const out: EdrFeature[] = [];
  for (let i = 0; queues.some((q) => i < q.length); i++) {
    for (const q of queues) if (i < q.length) out.push(q[i]);
  }
  return out;
}

/**
 * Round-robin the deep-crawl pages so a page budget spreads across Europe.
 *
 * Same lesson as {@link interleaveByCountry}, and it matters more here: Germany
 * has 281 unread pages to Austria's 40, and the countries are swept
 * alphabetically. Drained in order, DE would eat an entire run's budget and
 * everything after it in the alphabet would wait for the German crawl to finish.
 */
export function interleavePages(byCountry: Map<string, number[]>): { cc: string; page: number }[] {
  const entries = [...byCountry.entries()];
  const out: { cc: string; page: number }[] = [];
  for (let i = 0; entries.some(([, q]) => i < q.length); i++) {
    for (const [cc, q] of entries) if (i < q.length) out.push({ cc, page: q[i] });
  }
  return out;
}

/**
 * Decide what a country's deep crawl should do this run.
 *
 * Pure so the awkward cases are testable without a gateway: the page numbers only
 * mean anything relative to a pinned window, and every branch here is about
 * keeping that pin honest.
 *
 * - no cursor / crawl finished long enough ago  → open a fresh crawl over `now`
 * - totalPages moved under an open crawl        → the pin isn't holding, restart
 * - crawl finished recently                     → nothing; the middle is known
 * - otherwise                                   → resume from nextPage, same window
 */
export function planCrawl(
  cc: string,
  liveTotalPages: number,
  cursor: CrawlCursor | undefined,
  now: Date,
  recrawlMs = RECRAWL_MS(),
): { action: "start" | "resume" | "skip"; window: EdrWindow; pages: number[] } {
  const fresh = { action: "start" as const, window: windowFor(now), pages: [] as number[] };
  const pagesFrom = (n: number, total: number) => {
    const out: number[] = [];
    for (let p = Math.max(2, n); p <= total; p++) out.push(p);
    return out;
  };

  if (!cursor) return { ...fresh, pages: pagesFrom(2, liveTotalPages) };

  if (cursor.completedAt) {
    const age = now.getTime() - new Date(cursor.completedAt).getTime();
    if (age < recrawlMs) return { action: "skip", window: windowFor(now), pages: [] };
    return { ...fresh, pages: pagesFrom(2, liveTotalPages) };
  }

  // An open crawl's window is pinned, so its totalPages must not move. If it has,
  // the pin is not being honoured (or the feed changed shape) and the remembered
  // page numbers point at the wrong rows — which is the exact failure a naive
  // cursor over the rolling window would have had. Throw it away and re-pin.
  const w: EdrWindow = { from: new Date(cursor.windowFrom), to: new Date(cursor.windowTo) };
  if (cursor.nextPage > cursor.totalPages) {
    return { ...fresh, pages: pagesFrom(2, liveTotalPages) };
  }
  return { action: "resume", window: w, pages: pagesFrom(cursor.nextPage, cursor.totalPages) };
}

/**
 * Fill the EMMA_ID → boundary cache from MeteoGate.
 *
 * Cost control IS the design, but it used to be aimed at the wrong thing. The old
 * comment here read "resolving one alert costs two requests, so a run can only
 * ever resolve ~150–200 alerts" — and that is false. **Only page fetches spend
 * quota.** The rel=json/rel=geometry links are pre-signed object-store URLs;
 * measured live, 160 of them moved the counter by zero while 42 page fetches
 * moved it 42. Rationing resolves while starving the page walk was exactly
 * backwards, and it is why half of Europe had no boundary.
 *
 * So: MeteoGate allows 500 gateway requests per hour, the sweep is hourly, and
 * every one of those requests is a PAGE. Spend them widely (round-robin, both
 * passes) and stop before the window blows, since a 429 locks out every country
 * until the hour rolls over. Resolving is free, so the only limit on it is time.
 *
 * Tolerant by design: one country's failure must not lose the rest of Europe.
 */
export async function syncAreaGeometry(
  db: AppDb,
  opts: { now?: Date; budget?: number } = {},
): Promise<GeomSyncResult> {
  const now = opts.now ?? new Date();
  // Alerts to resolve per run. Costs no quota (see above) — this bounds the run's
  // WALL CLOCK, nothing else, since each resolve is two round-trips to the store.
  const budget = opts.budget ?? Number(process.env.METEOGATE_BUDGET || 100);
  const res: GeomSyncResult = {
    countries: 0,
    features: 0,
    resolved: 0,
    cached: 0,
    skipped: 0,
    crawlPages: 0,
    crawlsCompleted: 0,
    backfilled: 0,
    reconciled: 0,
    repaired: 0,
    quotaStopped: false,
    quotaRemaining: null,
    coverage: null,
    failures: [],
  };

  // Heal boundaries cached before geometry was repaired on the way in. Done
  // FIRST and unconditionally: it costs no network and no MeteoGate quota (the
  // shapes are already here — they need fixing, not re-fetching), and a run that
  // stops on the quota below must still have healed. Self-terminating.
  try {
    const r = await repairCachedGeometry(db.alertAreaGeom);
    res.repaired = r.repaired;
    if (r.repaired || r.unfixable) log(TAG, `repaired cached boundaries Mongo would refuse`, r);
  } catch (err) {
    res.failures.push(`repair-cached: ${String((err as Error)?.message ?? err)}`);
  }

  // Then join what we already hold onto the alerts that still have no shape.
  // AFTER the repair, so a boundary that was only just made storable gets applied
  // on this run rather than the next, and — like the repair — before the quota can
  // stop us: this is the half of the work that owes MeteoGate nothing.
  try {
    await reconcileCachedGeometry(db, res);
  } catch (err) {
    res.failures.push(`reconcile: ${String((err as Error)?.message ?? err)}`);
  }

  // One feature per alert per country: the feed repeats each alert per language
  // and per area, and they all resolve through the same linked CAP document.
  const byCountry = new Map<string, Map<string, EdrFeature>>();
  const keep = (cc: string, feats: EdrFeature[]) => {
    res.features += feats.length;
    const seenHere = byCountry.get(cc) ?? new Map<string, EdrFeature>();
    for (const f of feats) if (!seenHere.has(f.alertId)) seenHere.set(f.alertId, f);
    byCountry.set(cc, seenHere);
  };

  let pagesLeft = PAGE_BUDGET();
  const outOfPages = () => pagesLeft <= 0 || quotaLow();

  // ---- Pass 1: freshness. Page 1 (which also reports the page count) and the
  // last couple, where new alerts land. Every country, every run — this is the
  // read that keeps up with the feed, and it's what the sweep used to do ALONE.
  const cursors = await db.alertAreaGeom.crawlCursors();
  const totals = new Map<string, number>();
  for (const cc of meteogateCountries()) {
    if (outOfPages()) {
      res.quotaStopped = true;
      break;
    }
    try {
      const p1 = await fetchCountryPage(cc, 1, now);
      pagesLeft--;
      totals.set(cc, p1.totalPages);
      keep(cc, p1.features);
      res.countries++;

      const tail = freshPages(p1.totalPages).filter((p) => p !== 1);
      const got = await fetchPages(cc, tail, windowFor(now), outOfPages);
      pagesLeft -= got.read.length;
      keep(cc, got.features);
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.quotaStopped = true;
        break;
      }
      res.failures.push(`${cc}: ${String((err as Error)?.message ?? err)}`);
    }
  }

  // ---- Pass 2: the deep crawl. Everything pass 1 doesn't reach — 87% of the
  // feed, and where the missing boundaries actually are. Round-robin so one
  // 281-page country can't spend the budget alone, and resumable so the 565
  // pages Europe adds up to can cross runs instead of needing an impossible one.
  const plans = new Map<string, ReturnType<typeof planCrawl>>();
  const queues = new Map<string, number[]>();
  for (const [cc, totalPages] of totals) {
    const plan = planCrawl(cc, totalPages, cursors.get(cc), now);
    if (plan.action === "skip" || !plan.pages.length) continue;
    plans.set(cc, plan);
    queues.set(cc, plan.pages);
    if (plan.action === "start") {
      try {
        await db.alertAreaGeom.startCrawl({
          countryCode: cc,
          windowFrom: plan.window.from,
          windowTo: plan.window.to,
          totalPages,
        });
      } catch (err) {
        res.failures.push(`crawl-start ${cc}: ${String((err as Error)?.message ?? err)}`);
        queues.delete(cc);
      }
    }
  }

  const reached = new Map<string, number>();
  for (const { cc, page } of interleavePages(queues)) {
    if (outOfPages()) {
      res.quotaStopped = true;
      break;
    }
    try {
      const p = await fetchCountryPage(cc, page, plans.get(cc)!.window);
      pagesLeft--;
      res.crawlPages++;
      keep(cc, p.features);
      reached.set(cc, Math.max(reached.get(cc) ?? 0, page));
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.quotaStopped = true;
        break;
      }
      // A single bad page must not abandon the country's crawl — but do NOT
      // advance past it, or the boundaries it carries are lost until the next
      // full re-crawl. Leaving nextPage put means the next run retries it.
      res.failures.push(`${cc} p${page}: ${String((err as Error)?.message ?? err)}`);
      break;
    }
  }

  // Record how far each crawl actually got. `reached` is the highest page that
  // came back, and advanceCrawl only moves nextPage forward, so a run that dies
  // mid-country resumes rather than restarts.
  for (const [cc, page] of reached) {
    const done = page >= (plans.get(cc)?.pages.at(-1) ?? page);
    if (done) res.crawlsCompleted++;
    try {
      await db.alertAreaGeom.advanceCrawl(cc, page + 1, done);
    } catch (err) {
      res.failures.push(`crawl-advance ${cc}: ${String((err as Error)?.message ?? err)}`);
    }
  }

  const all = new Map<string, EdrFeature[]>();
  for (const [cc, m] of byCountry) all.set(cc, [...m.values()]);
  const total = [...all.values()].reduce((n, q) => n + q.length, 0);

  const seen = await db.alertAreaGeom.seenAlertIds([...all.values()].flat().map((f) => f.alertId));
  for (const [cc, q] of all) all.set(cc, q.filter((f) => !seen.has(f.alertId)));
  const todo = interleaveByCountry(all);
  res.skipped = total - todo.length;

  const areas = [];
  const marks: { alertId: string; emmaId?: string }[] = [];
  // NO quota check here, deliberately. resolveFeature only touches pre-signed
  // rel=* links, which cost nothing — measured, 160 of them moved the counter by
  // zero. This loop used to bail on quotaLow(), which meant a run spent its whole
  // hourly quota reading pages and then refused to resolve the features those
  // pages had just bought: live, 18 countries fully crawled produced ONE new
  // boundary. Same wrong belief as the page cap it was paired with. A link that
  // does 429 still ends the run via RateLimitError below.
  for (const f of todo.slice(0, budget)) {
    try {
      const { area, emmaId } = await resolveFeature(f);
      res.resolved++;
      // Mark even when it yielded no area: an alert with no EMMA_ID will never
      // resolve, so remembering it stops us paying for it again every run.
      marks.push({ alertId: f.alertId, emmaId });
      if (area) areas.push(area);
    } catch (err) {
      if (err instanceof RateLimitError) {
        res.quotaStopped = true;
        break; // the window is spent; leave the rest unmarked so a later run retries
      }
      res.failures.push(`${f.alertId}: ${String((err as Error)?.message ?? err)}`);
    }
  }

  if (areas.length) {
    const r = await db.alertAreaGeom.upsertAreas(areas);
    res.cached = r.upserted;

    // Clear stored `geometry: null`s first, or filling ONE area of a multi-area
    // alert makes the doc indexable and its null siblings reject the write.
    try {
      await db.alerts.dropNullGeometries();
    } catch (err) {
      res.failures.push(`drop-nulls: ${String((err as Error)?.message ?? err)}`);
    }

    // Apply each boundary to alerts ALREADY stored for that area. Ingest enrich
    // only ever sees new alerts — `upsert` skips unchanged active ones — so
    // without this a live alert stays shapeless until it expires, however full
    // the cache gets. Newly-resolved areas only, so this stays cheap.
    for (const emmaId of new Set(areas.map((a) => a.emmaId))) {
      const geometry = areas.find((a) => a.emmaId === emmaId)!.geometry;
      try {
        res.backfilled += await db.alerts.backfillAreaGeometry(emmaId, geometry);
      } catch (err) {
        // A polygon Mongo's 2dsphere rejects must not lose the rest of the run.
        res.failures.push(`backfill ${emmaId}: ${String((err as Error)?.message ?? err)}`);
      }
    }
  }
  await db.alertAreaGeom.markSeen(marks);

  // Measured AFTER the writes, so it reflects this run rather than the last one.
  // Costs no quota — it's a Mongo scan of what we already hold.
  try {
    res.coverage = await db.alerts.geometryCoverage();
    const c = res.coverage;
    log(TAG, `drawable coverage`, {
      ...c,
      areasDrawnPct: c.areas ? +(((c.areas - c.areasNoGeom) / c.areas) * 100).toFixed(1) : 0,
      // The silent one: these are ON AIR right now, missing pieces, looking fine.
      partialPct: c.alerts ? +((c.alertsPartial / c.alerts) * 100).toFixed(1) : 0,
    });
  } catch (err) {
    res.failures.push(`coverage: ${String((err as Error)?.message ?? err)}`);
  }

  res.quotaRemaining = quota().remaining;
  if (res.quotaStopped) {
    log(TAG, `stopped on the MeteoGate quota — resumes next run`, {
      remaining: res.quotaRemaining,
      resetSec: quota().resetSec,
      resolved: res.resolved,
    });
  } else if (todo.length > budget) {
    log(TAG, `budget reached — ${todo.length - budget} alerts deferred to the next run`, {
      budget,
      pending: todo.length - budget,
    });
  }
  return res;
}
