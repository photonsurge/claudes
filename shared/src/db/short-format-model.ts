import mongoose, { Connection } from "mongoose";
import { iGeneralModel, mongoTimestamps } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";
import type { ShortFormat } from "../short-format";

/**
 * Short video formats' own settings (docs/short-video-plan.md §5.2) — one doc
 * per format, keyed by `id`, which is also the id of the hidden scene the
 * format owns (its look lives on that scene doc and its director config, not
 * here). Every nested field is spelled out: the schema is strict, and a field
 * missing here is silently dropped on write (short-format-repo.test.ts
 * round-trips a fully populated format to prove none is).
 */
export interface iShortFormat extends iGeneralModel, Omit<ShortFormat, "id"> {}

export interface iShortFormatModel extends iShortFormat {
  id: string;
  _id: string;
}

const sub = (def: mongoose.SchemaDefinition) => new mongoose.Schema(def, { _id: false });

const PlaceSchema = sub({
  type: { type: String, required: true, enum: ["country", "area"] },
  id: { type: String, required: true },
});

// `places` (several places in one video) carries the ordered list instead of an id.
const ScopeSchema = sub({
  type: { type: String, required: true, enum: ["country", "area", "globe", "places"] },
  id: { type: String },
  places: { type: [PlaceSchema], default: undefined },
});

const IncludeSchema = sub({
  alerts: { type: Boolean, required: true, default: false },
  quakes: { type: Boolean, required: true, default: false },
  volcanoes: { type: Boolean, required: true, default: false },
});

// Either { source: "image", url } or { source: "frame", atMs }.
const ThumbnailSchema = sub({
  source: { type: String, required: true, enum: ["image", "frame"] },
  url: { type: String },
  atMs: { type: Number },
});

export const ShortFormatSchema = new mongoose.Schema<iShortFormatModel>(
  {
    id: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    template: {
      type: sub({
        scope: { type: ScopeSchema, default: undefined },
        include: { type: IncludeSchema, required: true },
        budgetMs: { type: Number, required: true },
        openWithWorld: { type: Boolean, required: true, default: false },
      }),
      required: true,
    },
    opener: {
      type: sub({
        leadWithRoundup: { type: Boolean, required: true },
        roundupDepth: { type: String, required: true, enum: ["summary", "full"] },
        tour: { type: Boolean, required: true },
        minTourDwellMs: { type: Number, required: true },
        budgetShare: { type: Number, required: true },
      }),
      required: true,
    },
    close: {
      type: sub({ enabled: { type: Boolean, required: true }, ms: { type: Number, required: true } }),
      required: true,
    },
    video: {
      type: sub({
        title: { type: String, required: true },
        description: { type: String, default: "" },
        timezone: { type: String, required: true },
        thumbnail: { type: ThumbnailSchema, required: true },
        tags: { type: [String], default: [] },
        categoryId: { type: String, required: true },
        playlistId: { type: String },
        publishAs: { type: String, required: true, enum: ["public", "unlisted", "private"] },
        chapters: { type: Boolean, required: true },
      }),
      required: true,
    },
    timing: {
      type: sub({ leadInMs: { type: Number, required: true }, leadOutMs: { type: Number, required: true } }),
      required: true,
    },
    render: { type: sub({ encoderId: { type: String }, accountId: { type: String } }), default: {} },
    layout: { type: String, required: true, enum: ["landscape"], default: "landscape" },
  },
  mongoTimestamps,
);

export const getShortFormatModel = (conn: Connection) =>
  getModel<iShortFormatModel>(conn, "ShortFormat", ShortFormatSchema);
