import type { Model } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import type { Volcano, VolcanoStatus } from "../volcanoes/types";
import type { iVolcanoModel } from "./volcano-model";

/**
 * Mongo predicate for "this volcano is worth spending per-volcano effort on" —
 * erupting/unrest, an elevated USGS alert or aviation colour, an elevated official
 * (e.g. GeoNet) level, or currently listed in the GVP weekly bulletin (the bulletin
 * only lists volcanoes with something happening).
 *
 * This is the FLOOR that keeps per-volcano jobs from scaling with the catalog. The
 * catalog is ~2,647 volcanoes but only tens are ever active, and the vast majority
 * are dormant forever — sweeping all of them on a schedule is exactly the
 * unbounded "enrich everything" mistake the cities enrich-all made.
 *
 * Note this is a QUERY twin of worker `shouldPromoteVolcano`; keep them in step.
 */
export function significantVolcanoFilter(now: Date = new Date(), bulletinWindowSec = 14 * 24 * 60 * 60) {
  return {
    $or: [
      { status: { $in: ["erupting", "unrest"] } },
      { usgsAlertLevel: { $in: ["WATCH", "WARNING"] } },
      { usgsColorCode: { $in: ["ORANGE", "RED"] } },
      { officialAlertLevelNormalized: { $in: ["advisory", "watch", "warning", "unrest", "eruption"] } },
      { bulletinAt: { $gt: new Date(now.getTime() - bulletinWindowSec * 1000) } },
    ],
  };
}

const strip = (doc: any): Volcano => ({
  id: doc.volcanoId,
  name: doc.name,
  country: doc.country || undefined,
  lat: doc.lat,
  lng: doc.lng,
  status: doc.status as VolcanoStatus,
  firstDate: new Date(doc.firstDate).getTime(),
  lastDate: new Date(doc.lastDate).getTime(),
  statusChangedAt: new Date(doc.statusChangedAt).getTime(),
  sourceUrl: doc.sourceUrl || undefined,
  latestReport: doc.latestReport || undefined,
  reportDateRange: doc.reportDateRange || undefined,
  bulletinAt: doc.bulletinAt ? new Date(doc.bulletinAt).getTime() : undefined,
  archiveEnabled: doc.archiveEnabled ?? undefined,
  catalogSource: doc.catalogSource || undefined,
  catalogFetchedAt: doc.catalogFetchedAt ? new Date(doc.catalogFetchedAt).getTime() : undefined,
  volcanicLandform: doc.volcanicLandform || undefined,
  region: doc.region || undefined,
  subregion: doc.subregion || undefined,
  tectonicSetting: doc.tectonicSetting || undefined,
  geologicEpoch: doc.geologicEpoch || undefined,
  evidenceCategory: doc.evidenceCategory || undefined,
  majorRockTypes: doc.majorRockTypes?.length ? doc.majorRockTypes : undefined,
  geologicalSummary: doc.geologicalSummary || undefined,
  primaryPhotoUrl: doc.primaryPhotoUrl || undefined,
  primaryPhotoCaption: doc.primaryPhotoCaption || undefined,
  primaryPhotoCredit: doc.primaryPhotoCredit || undefined,
  searchOverride: doc.searchOverride || undefined,
  wikiTitle: doc.wikiTitle || undefined,
  wikiThumb: doc.wikiThumb || undefined,
  wikiPhoto: doc.wikiPhoto || undefined,
  wikiExtract: doc.wikiExtract || undefined,
  wikiGallery: doc.wikiGallery?.length ? doc.wikiGallery : undefined,
  wikiFetchedAt: doc.wikiFetchedAt ? new Date(doc.wikiFetchedAt).getTime() : undefined,
  elevationM: doc.elevationM ?? undefined,
  volcanoType: doc.volcanoType || undefined,
  lastEruptionYear: doc.lastEruptionYear ?? undefined,
  usgsAlertLevel: doc.usgsAlertLevel || undefined,
  usgsColorCode: doc.usgsColorCode || undefined,
  usgsNoticeSynopsis: doc.usgsNoticeSynopsis || undefined,
  usgsNoticeUrl: doc.usgsNoticeUrl || undefined,
  usgsUpdatedAt: doc.usgsUpdatedAt ? new Date(doc.usgsUpdatedAt).getTime() : undefined,
  officialSource: doc.officialSource || undefined,
  officialAlertScheme: doc.officialAlertScheme || undefined,
  officialAlertLevelRaw: doc.officialAlertLevelRaw || undefined,
  officialAlertLevelNormalized: doc.officialAlertLevelNormalized || undefined,
  officialActivity: doc.officialActivity || undefined,
  officialUpdatedAt: doc.officialUpdatedAt ? new Date(doc.officialUpdatedAt).getTime() : undefined,
  reportVei: doc.reportVei ?? undefined,
  reportPlumeHeightM: doc.reportPlumeHeightM ?? undefined,
  reportParsedAt: doc.reportParsedAt ? new Date(doc.reportParsedAt).getTime() : undefined,
});

/**
 * Active-volcano persistence + overlay reads. `upsertMany` dedups on the source
 * `volcanoId` (a re-poll while still active refreshes `fetchedAt`, extending its
 * TTL); `list` returns everything by default — no cap.
 */
export function makeVolcanoRepo(model: Model<iVolcanoModel>) {
  return {
    model,

    /**
     * Upsert a batch of volcanoes on `volcanoId`. Fills the GeoJSON `loc`. Uses
     * an aggregation-pipeline update (not a plain `$set`/`$setOnInsert`) so two
     * fields can depend on the PREVIOUS stored value, which a plain update
     * can't express:
     *  - `firstDate` only set on the FIRST insert (`$ifNull` against the
     *    existing value) — tracks "since when has our cache been tracking this
     *    volcano" rather than the source's own event-start concept (the weekly
     *    bulletin doesn't have one), so it must not be overwritten on re-poll.
     *  - `statusChangedAt` only advances when `status` actually differs from
     *    what's already stored (or the doc is new) — the source republishes
     *    weekly regardless of whether anything changed, so a plain `$set`
     *    would make every volcano look like it "just changed" on every poll.
     */
    async upsertMany(volcanoes: Volcano[]): Promise<{ upserted: number; matched: number }> {
      if (!volcanoes.length) return { upserted: 0, matched: 0 };
      const fetchedAt = new Date();
      const ops = volcanoes.map((v) => ({
        updateOne: {
          filter: { volcanoId: v.id },
          update: [
            {
              $set: {
                id: { $ifNull: ["$id", uuidv4()] },
                name: v.name,
                country: v.country,
                lat: v.lat,
                lng: v.lng,
                status: v.status,
                firstDate: { $ifNull: ["$firstDate", new Date(v.firstDate)] },
                lastDate: new Date(v.lastDate),
                statusChangedAt: {
                  $cond: [{ $eq: ["$status", v.status] }, { $ifNull: ["$statusChangedAt", fetchedAt] }, fetchedAt],
                },
                sourceUrl: v.sourceUrl,
                latestReport: v.latestReport,
                reportDateRange: v.reportDateRange,
                fetchedAt,
                loc: { type: "Point" as const, coordinates: [v.lng, v.lat] as [number, number] },
              },
            },
          ],
          upsert: true,
        },
      }));
      const res = await model.bulkWrite(ops);
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    /** Active volcanoes (most recently updated first), optionally filtered by status/bbox. */
    async list(opts: {
      status?: VolcanoStatus;
      bbox?: [number, number, number, number];
      limit?: number;
    } = {}): Promise<Volcano[]> {
      const q: Record<string, unknown> = {};
      if (opts.status) q.status = opts.status;
      if (opts.bbox) {
        const [w, s, e, n] = opts.bbox;
        q.loc = {
          $geoWithin: { $geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } },
        };
      }
      // limit(0) = no cap: show every active volcano by default.
      let query = model.find(q).sort({ lastDate: -1 }).limit(opts.limit ?? 0);
      // Force the geo index on bbox reads so the planner skips its multi-plan
      // trial run (else it may walk `volcano_last_date_ix` geo-filtering and
      // burn 100ms+ of planningTimeMicros, replanning across box sizes).
      if (opts.bbox) query = query.hint("volcano_geo_ix");
      const docs = await query.lean().exec();
      return docs.map(strip);
    },

    /**
     * The volcanoes actually worth spending work on — erupting, in unrest, under
     * an official alert, or recently in the weekly bulletin.
     *
     * The catalog is ~1,196 volcanoes and all but a few dozen are dormant, so any
     * per-volcano job that walks `list()` does ~1,196 units of work to produce a
     * few dozen useful results. Media acquisition uses this instead.
     */
    async listSignificant(now: Date = new Date()): Promise<Volcano[]> {
      const docs = await model.find(significantVolcanoFilter(now)).sort({ lastDate: -1 }).lean().exec();
      return docs.map(strip);
    },

    /** A single volcano by its source id (the admin detail read), or null. */
    async get(volcanoId: string): Promise<Volcano | null> {
      const doc = await model.findOne({ volcanoId }).lean().exec();
      return doc ? strip(doc) : null;
    },

    /**
     * The currently-stored docs for a set of source ids, in one `$in` read.
     * Used as the PREV capture before `upsertMany` overwrites them, so the
     * volcano-timeline hook can diff prev-vs-persisted (see
     * worker/src/jobs/volcanoes.ts + shared/src/volcanoes/diff.ts). Returns only
     * the volcanoes it actually has — a first-seen id is simply absent.
     */
    async listByIds(volcanoIds: string[]): Promise<Volcano[]> {
      if (!volcanoIds.length) return [];
      const docs = await model.find({ volcanoId: { $in: volcanoIds } }).lean().exec();
      return docs.map(strip);
    },

    async count(): Promise<number> {
      return model.estimatedDocumentCount();
    },

    /** Volcanoes whose Wikipedia enrichment is missing or older than `staleBefore` (unless `force`). */
    /**
     * Volcanoes due a Wikipedia/Wikidata enrichment pass.
     *
     * SIGNIFICANT-ONLY BY DEFAULT. This is the one job whose cost scales with the
     * CATALOG rather than with a fixed number of feeds, so with ~2,647 volcanoes an
     * ungated sweep would hammer Wikipedia with thousands of requests on a 6-hour
     * schedule, forever, for volcanoes that have been dormant for millennia.
     *
     * Dormant volcanoes lose nothing: the GVP catalog seed already gives every
     * volcano a geology write-up (100% coverage) and a photo (~94%), fetched ONCE.
     * Wikipedia only adds a nicer gallery/extract, which matters just for volcanoes
     * heading on air.
     *
     * `force` ignores the staleness gate but KEEPS the significance floor.
     * `includeDormant` is the deliberate escape hatch for a one-off full sweep —
     * never a default (that's precisely how the cities enrich-all went OTT).
     *
     * A volcano carrying an operator-set `searchOverride` clears the significance
     * floor: the operator typed that term by hand for this exact volcano, and most
     * of the ones needing a nudge are dormant (fixed while prepping them for air),
     * so gating them out would make the override silently do nothing. This doesn't
     * reopen the enrich-all door — the set is bounded by what a human typed, and
     * `setSearchOverride` clears `wikiFetchedAt` so each override costs one pass.
     *
     * `ids` NARROWS the sweep to specific source ids — used by the first-seen hook
     * (worker/src/jobs/volcanoes.ts#snapshot) to enrich just the volcanoes that
     * appeared in this bulletin. It narrows and never widens: the staleness gate
     * and significance floor still apply, so it can only ever enrich a subset of
     * what a full pass would.
     */
    async listNeedingEnrichment(
      staleBefore: Date,
      force = false,
      opts: { includeDormant?: boolean; ids?: string[] } = {},
    ): Promise<iVolcanoModel[]> {
      if (opts.ids && !opts.ids.length) return [];
      const and: Record<string, unknown>[] = [];
      if (opts.ids) and.push({ volcanoId: { $in: opts.ids } });
      if (!force) and.push({ wikiFetchedAt: { $not: { $gt: staleBefore } } });
      if (!opts.includeDormant) {
        and.push({ $or: [significantVolcanoFilter(), { searchOverride: { $exists: true, $ne: "" } }] });
      }
      return model.find(and.length ? { $and: and } : {}).lean().exec();
    },

    /**
     * Volcanoes with report text that hasn't been LLM-parsed since it last
     * changed — i.e. `reportParsedAt` missing, or older than this week's
     * `lastDate` (a fresh bulletin landed since the last parse). Unlike wiki
     * enrichment's 30-day gate, this re-checks every new weekly report.
     */
    async listNeedingReportParse(): Promise<iVolcanoModel[]> {
      return model
        .find({
          latestReport: { $exists: true, $ne: "" },
          $expr: { $or: [{ $eq: ["$reportParsedAt", null] }, { $lt: ["$reportParsedAt", "$lastDate"] }] },
        })
        .lean()
        .exec();
    },

    /** Patch Wikipedia/Wikidata/LLM enrichment fields onto one volcano by its source `volcanoId`. */
    async updateEnrichment(
      volcanoId: string,
      patch: {
        wikiTitle?: string;
        wikiThumb?: string;
        wikiPhoto?: string;
        wikiExtract?: string;
        wikiGallery?: string[];
        wikiFetchedAt?: Date;
        elevationM?: number;
        volcanoType?: string;
        lastEruptionYear?: number;
        reportVei?: number;
        reportPlumeHeightM?: number;
        reportParsedAt?: Date;
      },
    ): Promise<void> {
      await model.updateOne({ volcanoId }, { $set: patch }).exec();
    },

    /**
     * Patch USGS VONA alert fields onto a volcano, upserting a bare-bones stub
     * doc if it isn't already tracked from this week's GVP bulletin (USGS's
     * monitored set and the weekly bulletin's set don't perfectly overlap).
     * Never touches firstDate/status/etc. — those stay GVP-bulletin-owned.
     * Also bumps `fetchedAt` so a volcano USGS still lists as elevated doesn't
     * age out of the TTL just because the weekly bulletin stopped mentioning it.
     */
    async updateUsgsAlert(
      volcanoId: string,
      stub: { name: string; lat: number; lng: number },
      patch: {
        usgsAlertLevel?: string;
        usgsColorCode?: string;
        usgsNoticeSynopsis?: string;
        usgsNoticeUrl?: string;
        usgsUpdatedAt: Date;
      },
    ): Promise<void> {
      const now = new Date();
      await model
        .updateOne(
          { volcanoId },
          {
            $set: { ...patch, fetchedAt: now },
            $setOnInsert: {
              id: uuidv4(),
              name: stub.name,
              lat: stub.lat,
              lng: stub.lng,
              status: "unrest",
              firstDate: now,
              lastDate: now,
              statusChangedAt: now,
              loc: { type: "Point" as const, coordinates: [stub.lng, stub.lat] as [number, number] },
            },
          },
          { upsert: true },
        )
        .exec();
    },

    /**
     * Patch USGS alert fields onto a volcano ONLY if we already track it — no
     * upsert (so a NORMAL/GREEN US volcano we've never tracked doesn't mint a
     * dormant stub) and no `fetchedAt` bump (so a downgraded volcano still ages
     * out via the GVP-bulletin TTL). This is how a WARNING→NORMAL de-escalation
     * lands a timeline beat without flooding the cache with ~150 quiet US cones.
     * Returns whether a doc matched. See worker/src/jobs/volcanoes.ts#snapshotUsgs.
     */
    async updateUsgsAlertIfExists(
      volcanoId: string,
      patch: {
        usgsAlertLevel?: string;
        usgsColorCode?: string;
        usgsNoticeSynopsis?: string;
        usgsNoticeUrl?: string;
        usgsUpdatedAt: Date;
      },
    ): Promise<boolean> {
      const res = await model.updateOne({ volcanoId }, { $set: patch }).exec();
      return (res.matchedCount ?? 0) > 0;
    },

    /**
     * Patch official (non-USGS) observatory status onto a volcano we already
     * track — no upsert (the crosswalk resolves against cached volcanoes, so it
     * exists). `keepAlive` bumps `fetchedAt` for a currently-elevated volcano so
     * it doesn't age out of the TTL; omit it for a downgrade so a quieting
     * volcano lapses via the GVP-bulletin TTL. Returns whether a doc matched.
     */
    async updateOfficialStatus(
      volcanoId: string,
      patch: {
        officialSource: string;
        officialAlertScheme: string;
        officialAlertLevelRaw: string;
        officialAlertLevelNormalized: string;
        officialActivity?: string;
        officialUpdatedAt: Date;
      },
      opts: { keepAlive?: boolean } = {},
    ): Promise<boolean> {
      const set: Record<string, unknown> = { ...patch };
      if (opts.keepAlive) set.fetchedAt = new Date();
      const res = await model.updateOne({ volcanoId }, { $set: set }).exec();
      return (res.matchedCount ?? 0) > 0;
    },

    /**
     * Ensure a volcano doc exists for `volcanoId`, creating a bare stub from the
     * GVP catalog if it isn't already tracked (a foreign volcano that an external
     * source, e.g. GeoNet, reports as active but that isn't in the weekly GVP
     * bulletin). Never clobbers an existing doc's GVP-owned fields — identity +
     * initial status are `$setOnInsert` only; always bumps `fetchedAt` so it
     * stays alive while the external source keeps it elevated.
     */
    async upsertStub(
      volcanoId: string,
      stub: { name: string; lat: number; lng: number; country?: string; status: VolcanoStatus; sourceUrl?: string; elevationM?: number },
    ): Promise<void> {
      const now = new Date();
      await model
        .updateOne(
          { volcanoId },
          {
            $set: { fetchedAt: now },
            $setOnInsert: {
              id: uuidv4(),
              name: stub.name,
              country: stub.country,
              lat: stub.lat,
              lng: stub.lng,
              status: stub.status,
              firstDate: now,
              lastDate: now,
              statusChangedAt: now,
              sourceUrl: stub.sourceUrl,
              elevationM: stub.elevationM,
              loc: { type: "Point" as const, coordinates: [stub.lng, stub.lat] as [number, number] },
            },
          },
          { upsert: true },
        )
        .exec();
    },

    /**
     * Seed/refresh the PERMANENT GVP catalog facts for a batch of volcanoes.
     *
     * Deliberately surgical about what it writes: `$set` touches ONLY catalog
     * fields (identity, geography, geology, GVP's own photo), and every activity
     * or enrichment field — `status`, `latestReport`, `bulletinAt`, `archiveEnabled`,
     * `official*`, `usgs*`, `wiki*` — is either `$setOnInsert` or untouched. A
     * reseed must never wipe enrichment or reset a volcano's live status: that is
     * exactly the trap the cities reseed fell into.
     *
     * The catalog is authoritative for name/coords/elevation/type/lastEruptionYear
     * (Wikidata only fills gaps), so those ARE refreshed — but undefined values are
     * stripped first, so a sparse Pleistocene row can't blank a Holocene field.
     */
    async upsertCatalogMany(
      records: {
        volcanoId: string;
        name: string;
        lat: number;
        lng: number;
        country?: string;
        elevationM?: number;
        volcanoType?: string;
        volcanicLandform?: string;
        region?: string;
        subregion?: string;
        tectonicSetting?: string;
        geologicEpoch?: string;
        evidenceCategory?: string;
        majorRockTypes?: string[];
        lastEruptionYear?: number;
        geologicalSummary?: string;
        primaryPhotoUrl?: string;
        primaryPhotoCaption?: string;
        primaryPhotoCredit?: string;
        sourceUrl?: string;
      }[],
      catalogSource = "gvp-wfs",
    ): Promise<{ upserted: number; matched: number }> {
      if (!records.length) return { upserted: 0, matched: 0 };
      const now = new Date();
      const ops = records.map((r) => {
        // Strip undefined so a sparse row never blanks an existing value.
        const set: Record<string, unknown> = { catalogSource, catalogFetchedAt: now };
        const catalogFields: Record<string, unknown> = {
          name: r.name,
          lat: r.lat,
          lng: r.lng,
          country: r.country,
          elevationM: r.elevationM,
          volcanoType: r.volcanoType,
          volcanicLandform: r.volcanicLandform,
          region: r.region,
          subregion: r.subregion,
          tectonicSetting: r.tectonicSetting,
          geologicEpoch: r.geologicEpoch,
          evidenceCategory: r.evidenceCategory,
          majorRockTypes: r.majorRockTypes,
          lastEruptionYear: r.lastEruptionYear,
          geologicalSummary: r.geologicalSummary,
          primaryPhotoUrl: r.primaryPhotoUrl,
          primaryPhotoCaption: r.primaryPhotoCaption,
          primaryPhotoCredit: r.primaryPhotoCredit,
          sourceUrl: r.sourceUrl,
          loc: { type: "Point" as const, coordinates: [r.lng, r.lat] as [number, number] },
        };
        for (const [k, v] of Object.entries(catalogFields)) if (v !== undefined) set[k] = v;
        return {
          updateOne: {
            filter: { volcanoId: r.volcanoId },
            update: {
              $set: set,
              // Activity state belongs to the ingest jobs — only seeded on FIRST insert,
              // never reset by a later reseed. `fetchedAt` no longer governs lifetime.
              $setOnInsert: {
                id: uuidv4(),
                volcanoId: r.volcanoId,
                status: "dormant" as VolcanoStatus,
                firstDate: now,
                lastDate: now,
                statusChangedAt: now,
                fetchedAt: now,
              },
            },
            upsert: true,
          },
        };
      });
      const res = await model.bulkWrite(ops, { ordered: false });
      return { upserted: res.upsertedCount ?? 0, matched: res.matchedCount ?? 0 };
    },

    /** Operator opt-in for the historical camera archive (P7 §7.11). */
    async setArchiveEnabled(volcanoId: string, enabled: boolean): Promise<boolean> {
      const res = await model.updateOne({ volcanoId }, { $set: { archiveEnabled: enabled } }).exec();
      return (res.matchedCount ?? 0) > 0;
    },

    /**
     * Operator-set Wikipedia search term for one volcano (empty/undefined clears
     * it, restoring the name-derived guesses). Clears `wikiFetchedAt` so the next
     * enrich pass re-queries with the new term instead of waiting out the 30-day
     * staleness gate — otherwise setting an override would look like it did
     * nothing for a month. Returns false when there's no such volcano.
     */
    async setSearchOverride(volcanoId: string, term: string | undefined): Promise<boolean> {
      const trimmed = term?.trim();
      const res = await model
        .updateOne(
          { volcanoId },
          trimmed
            ? { $set: { searchOverride: trimmed }, $unset: { wikiFetchedAt: "" } }
            : { $unset: { searchOverride: "", wikiFetchedAt: "" } },
        )
        .exec();
      return (res.matchedCount ?? 0) > 0;
    },

    /** The volcanoes the operator chose to keep a historical archive for. */
    async listArchiveEnabled(): Promise<Volcano[]> {
      const docs = await model.find({ archiveEnabled: true }).lean().exec();
      return docs.map(strip);
    },
  };
}

export type VolcanoRepo = ReturnType<typeof makeVolcanoRepo>;
