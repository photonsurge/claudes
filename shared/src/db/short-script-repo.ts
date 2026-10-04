import type { Model } from "mongoose";
import type { KindLook } from "../director";
import type { ShortClip, ShortPlace, ShortScope, ShortScript, ShortScriptPlay } from "../short-script";
import { DEFAULT_SHORT_FORMAT_ID } from "../short-scenes";
import type { iShortScriptModel } from "./short-script-model";

/** Copy only the keys that hold a value — the wire shape omits unset optional
 *  paths. `keepNull` is for look fields, where `null` means "inherit live". */
function compact<T extends object>(o: T, keepNull = false): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined || (v === null && !keepNull)) continue;
    out[k] = v;
  }
  return out as T;
}

function toClip(c: ShortClip): ShortClip {
  const clip: ShortClip = {
    id: c.id,
    target: c.target,
    durationMs: c.durationMs,
    label: compact({ title: c.label?.title ?? "", subtitle: c.label?.subtitle, icon: c.label?.icon }),
  };
  if (c.look) clip.look = compact({ ...(c.look as KindLook) }, true);
  if (typeof c.maxStops === "number") clip.maxStops = c.maxStops;
  if (typeof c.tourDwellMs === "number") clip.tourDwellMs = c.tourDwellMs;
  if (c.leadSlide === "roundup") clip.leadSlide = "roundup";
  if (c.roundupDepth === "summary" || c.roundupDepth === "full") clip.roundupDepth = c.roundupDepth;
  return clip;
}

function toPlay(p: ShortScriptPlay): ShortScriptPlay {
  return compact({
    sceneId: p.sceneId,
    playNonce: p.playNonce,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    stopped: p.stopped,
    runId: p.runId,
    clips: (p.clips ?? []).map((c) => ({ id: c.id, startMs: c.startMs, durationMs: c.durationMs })),
    skipped: (p.skipped ?? []).map((s) => ({ id: s.id, reason: s.reason })),
  });
}

/** String values only — a title code never resolves to an object. */
function toValues(v: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v)) if (typeof x === "string") out[k] = x;
  return out;
}

/** Canonical wire shape from a lean doc — drops `_id`/`__v`/timestamps and any
 *  unset optional path. */
function toShortScript(doc: iShortScriptModel): ShortScript {
  const scope: ShortScope =
    doc.scope.type === "globe"
      ? { type: "globe" }
      : doc.scope.type === "places"
        ? { type: "places", places: (doc.scope.places ?? []).map((p: ShortPlace) => ({ type: p.type, id: p.id })) }
        : { type: doc.scope.type, id: doc.scope.id };
  const script: ShortScript = {
    id: doc.id,
    formatId: doc.formatId || DEFAULT_SHORT_FORMAT_ID,
    template: doc.template,
    scope,
    include: { alerts: doc.include.alerts, quakes: doc.include.quakes, volcanoes: doc.include.volcanoes },
    title: doc.title,
    clips: (doc.clips ?? []).map(toClip),
    status: doc.status,
  };
  if (doc.plays?.length) script.plays = doc.plays.map(toPlay);
  if (doc.values && typeof doc.values === "object") script.values = toValues(doc.values);
  return script;
}

/** Fields an upsert writes. Never `plays`: those belong to the runner
 *  (`stampPlay`), so saving an edited script never wipes what it stamped. */
const setDoc = (s: ShortScript) => ({
  formatId: s.formatId || DEFAULT_SHORT_FORMAT_ID,
  template: s.template,
  scope: s.scope,
  include: s.include,
  title: s.title,
  clips: s.clips,
  status: s.status,
});

/**
 * Short-script persistence (`db.shortScripts`). Scripts are keyed by `id`;
 * callers pass already-sanitised scripts (see `sanitizeShortScript`).
 */
export function makeShortScriptRepo(model: Model<iShortScriptModel>) {
  return {
    model,

    /** All scripts, newest first. */
    async list(): Promise<ShortScript[]> {
      const docs = await model.find({}).sort({ created: -1 }).lean().exec();
      return docs.map((d) => toShortScript(d as iShortScriptModel));
    },

    /** One script by id, or null. */
    async get(id: string): Promise<ShortScript | null> {
      const doc = await model.findOne({ id }).lean().exec();
      return doc ? toShortScript(doc as iShortScriptModel) : null;
    },

    /** Create or replace a script by id; returns the stored wire shape. */
    async upsert(script: ShortScript): Promise<ShortScript> {
      await model
        .updateOne({ id: script.id }, { $set: setDoc(script), $setOnInsert: { id: script.id } }, { upsert: true })
        .exec();
      const doc = await model.findOne({ id: script.id }).lean().exec();
      return doc ? toShortScript(doc as iShortScriptModel) : script;
    },

    /**
     * How many scripts are made in `formatId` — the format delete guard. Scripts
     * saved before formats carry no id and count for the default format.
     */
    async countByFormat(formatId: string): Promise<number> {
      const q =
        formatId === DEFAULT_SHORT_FORMAT_ID
          ? { $or: [{ formatId }, { formatId: null }, { formatId: "" }] } // null matches a missing field too
          : { formatId };
      return model.countDocuments(q).exec();
    },

    /** Delete a script by id. Returns true if one was removed. */
    async remove(id: string): Promise<boolean> {
      const res = await model.deleteOne({ id }).exec();
      return (res.deletedCount ?? 0) > 0;
    },

    /**
     * Stamp the title-code values (short-video plan §6.8). Like `plays`, never
     * part of `upsert`, so saving an edited script keeps them. Returns false for
     * an unknown id.
     */
    async stampValues(id: string, values: Record<string, string>): Promise<boolean> {
      const res = await model.updateOne({ id }, { $set: { values: toValues(values) } }).exec();
      return (res.matchedCount ?? 0) > 0;
    },

    /**
     * The runner's record of what it really played on `play.sceneId`: replaces
     * that scene's entry in `plays` and leaves every other scene's alone.
     * Returns false for an unknown id.
     *
     * Two scenes can stamp the same script at the same instant, so the array is
     * never read and rewritten whole. Each write is one atomic single-document
     * op: replace the scene's entry in place (positional `$`), else append it —
     * guarded on the scene having no entry yet, so a racing append from the
     * same scene can't add a duplicate. If that guard loses the race (the other
     * write appended first) the in-place replace is tried once more.
     */
    async stampPlay(id: string, play: ShortScriptPlay): Promise<boolean> {
      const entry = toPlay(play);
      const replace = () =>
        model.updateOne({ id, "plays.sceneId": entry.sceneId }, { $set: { "plays.$": entry } }).exec();
      if (((await replace()).matchedCount ?? 0) > 0) return true;
      const pushed = await model
        .updateOne({ id, "plays.sceneId": { $ne: entry.sceneId } }, { $push: { plays: entry } })
        .exec();
      if ((pushed.matchedCount ?? 0) > 0) return true;
      return ((await replace()).matchedCount ?? 0) > 0;
    },
  };
}

export type ShortScriptRepo = ReturnType<typeof makeShortScriptRepo>;
