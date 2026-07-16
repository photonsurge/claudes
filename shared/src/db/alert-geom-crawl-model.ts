import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Where the deep page crawl of one country's EDR feed has got to.
 *
 * The sweep used to read three pages per country — page 1, the last, and the
 * second-to-last — and never the middle, on any run, ever. Measured live that is
 * 492 of 565 pages (87%) permanently invisible: Germany has 281 pages, Austria 42.
 * Half our warning areas had no boundary because the alert that would have taught
 * us one only ever appeared on a page we don't read. Proven, not inferred —
 * reading all 42 Austrian pages turned up 7 EMMA_IDs we lack, all on page 2.
 *
 * So the middle has to be walked. It can't be walked in one run (565 pages vs a
 * 500/hour gateway quota), which makes it a RESUMABLE crawl, and that is what this
 * row is.
 *
 * The window is frozen at `windowFrom`/`windowTo` and every page of a crawl is
 * fetched with that identical interval. This is the whole point of the row and
 * the reason a bare `nextPage` would not do: the feed's default window is the last
 * 23 hours and it MOVES. Alerts expire off the front and arrive at the back
 * between runs, so pages renumber under us — "next run, read page 5" would read
 * page 5 of a different result set, and areas would slip between pages unread
 * exactly as they do today. Pin the query, and page N means the same thing on
 * every run until the crawl finishes.
 *
 * Pure cache: losing a row costs one re-crawl, never a boundary (those live in
 * the permanent EMMA cache — see {@link iAlertAreaGeom}).
 */
export interface iAlertGeomCrawl extends iGeneralModel {
  /** EDR location id — the country code the crawl is walking. */
  countryCode: string;
  /** Start of the FROZEN datetime interval every page of this crawl uses. */
  windowFrom: Date;
  /** End of it. Never recomputed mid-crawl. */
  windowTo: Date;
  /** The next unread page. Starts at 2 — page 1 is read every run for freshness. */
  nextPage: number;
  /** As `metadata.total_pages` reported it for the frozen window. */
  totalPages: number;
  /** Set when nextPage passes totalPages. Until it expires, the middle is skipped. */
  completedAt?: Date;
  startedAt: Date;
  updatedAt: Date;
}

export interface iAlertGeomCrawlModel extends iAlertGeomCrawl {
  id: string;
  _id: string;
}

const AlertGeomCrawlSchema = new mongoose.Schema<iAlertGeomCrawlModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    countryCode: { type: String, required: true, unique: true },
    windowFrom: { type: Date, required: true },
    windowTo: { type: Date, required: true },
    nextPage: { type: Number, required: true, default: 2 },
    totalPages: { type: Number, required: true, default: 1 },
    completedAt: { type: Date, required: false },
    startedAt: { type: Date, required: true, default: () => new Date() },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

AlertGeomCrawlSchema.index({ countryCode: 1 }, { unique: true, name: "alert_geom_crawl_cc_ix" });

export const getAlertGeomCrawlModel = (conn: Connection) =>
  getModel<iAlertGeomCrawlModel>(conn, "AlertGeomCrawl", AlertGeomCrawlSchema);
