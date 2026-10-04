import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { ShortScript } from "../short-script";

/**
 * Scripted short videos (docs/short-video-plan.md §2) — one doc per script,
 * keyed by `id`. Every nested field is spelled out: the schema is strict, and a
 * field missing here is silently dropped on write (short-script-repo.test.ts
 * round-trips a fully populated script to prove none is).
 */
export interface iShortScript extends iGeneralModel, Omit<ShortScript, "id"> {}

export interface iShortScriptModel extends iShortScript {
  id: string;
  _id: string;
}

const sub = (def: mongoose.SchemaDefinition) => new mongoose.Schema(def, { _id: false });

// KindLook. Every field is nullable (null = "inherit the live setting").
const WindSchema = sub({
  numParticles: { type: Number },
  speedFactor: { type: Number },
  maxAge: { type: Number },
  width: { type: Number },
  opacity: { type: Number },
  color: { type: String },
});

const LookSchema = sub({
  basemap: { type: String },
  wind: { type: WindSchema, default: undefined },
  showSatImg: { type: Boolean },
  satImgLook: { type: String },
  activeVariable: { type: String },
  // Keyed by satellite feed id — dynamic keys, Mixed like kindLooks itself.
  satImgFeeds: { type: mongoose.Schema.Types.Mixed },
  auroraOpacity: { type: Number },
  magneticFieldOpacity: { type: Number },
});

const ClipSchema = sub({
  id: { type: String, required: true },
  target: { type: String, required: true },
  durationMs: { type: Number, required: true },
  look: { type: LookSchema, default: undefined },
  maxStops: { type: Number },
  tourDwellMs: { type: Number },
  leadSlide: { type: String, enum: ["roundup"] },
  roundupDepth: { type: String, enum: ["summary", "full"] },
  label: {
    type: sub({
      title: { type: String, required: true },
      subtitle: { type: String },
      icon: { type: String },
    }),
    required: true,
  },
});

const ScopeSchema = sub({
  type: { type: String, required: true, enum: ["country", "area", "globe"] },
  id: { type: String },
});

// Off by default, as the sanitizer: event clips are opt-in.
const IncludeSchema = sub({
  alerts: { type: Boolean, required: true, default: false },
  quakes: { type: Boolean, required: true, default: false },
  volcanoes: { type: Boolean, required: true, default: false },
});

// One entry per scene (ShortScriptPlay.sceneId) — the latest play there.
const PlaySchema = sub({
  sceneId: { type: String, required: true },
  playNonce: { type: Number, required: true },
  startedAt: { type: Number, required: true },
  endedAt: { type: Number },
  stopped: { type: Boolean },
  runId: { type: String },
  clips: {
    type: [sub({ id: String, startMs: Number, durationMs: Number })],
    default: [],
  },
  skipped: { type: [sub({ id: String, reason: String })], default: [] },
});

export const ShortScriptSchema = new mongoose.Schema<iShortScriptModel>(
  {
    id: { type: String, required: true, unique: true },
    // Not required: scripts saved before formats have none and read back as
    // the default format's (short-script-repo.ts).
    formatId: { type: String },
    template: { type: String, required: true, enum: ["lineup"], default: "lineup" },
    scope: { type: ScopeSchema, required: true },
    include: { type: IncludeSchema, required: true },
    title: { type: String, required: true },
    clips: { type: [ClipSchema], default: [] },
    status: { type: String, required: true, enum: ["draft", "ready"], default: "draft" },
    plays: { type: [PlaySchema], default: undefined },
    // Title-code values stamped at generate (short-video plan §6.8); free keys.
    values: { type: mongoose.Schema.Types.Mixed, default: undefined },
  },
  mongoTimestamps,
);

ShortScriptSchema.index({ created: -1 }, { name: "short_script_created_ix" });
// "How many scripts use this format" — the format delete guard.
ShortScriptSchema.index({ formatId: 1 }, { name: "short_script_format_ix" });

export const getShortScriptModel = (conn: Connection) =>
  getModel<iShortScriptModel>(conn, "ShortScript", ShortScriptSchema);
