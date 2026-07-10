// Single source of truth for the worker's bundled static data (the Natural
// Earth admin-0 geojson the countries.seed job masks area-weather against).
//
// In the repo these assets live in the Next app's served folder,
// public/public/data (populated by ./fetch-assets.sh). The worker must NOT
// reach into the public app's static dir at runtime — in Docker the two are
// separate images — so the location is overridable via WEATHER_DATA_DIR
// (set in worker/Dockerfile, which bakes the worker its own copy). The repo
// path is only the dev fallback.
import { resolve } from "node:path";

// dist layout: worker/dist/dataDir.js → ../.. = repo root → public/public/data.
export const DATA_DIR = process.env.WEATHER_DATA_DIR
  ? resolve(process.env.WEATHER_DATA_DIR)
  : resolve(__dirname, "../../public/public/data");

export const dataFile = (name: string): string => resolve(DATA_DIR, name);
