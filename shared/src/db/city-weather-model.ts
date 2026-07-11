import mongoose, { Connection } from "mongoose";
import { v4 as uuidv4 } from "uuid";
import { iGeneralModel } from "../interfaces/iGeneralModel";
import { getModel } from "../utill/getModel";

/**
 * Cached point weather for every "decent size" city (population ≥ threshold),
 * refreshed hourly by the worker (`cityWeather.refresh`) so the region dossier,
 * broadcast slides and the slim /watch region mode can read a city's conditions
 * without sampling GFS frames at request time.
 *
 * One doc per city (keyed by `cityId` → City.id). Holds the last 24h of observed
 * conditions (`hourly`, for a trend sparkline), the latest reading (`current`),
 * and a 3-day daily hi/lo forecast (`daily`). Values are in the archive's native
 * units (temp °C, wind/gust m/s, rain mm) — the caller formats.
 */
export interface iCityWeatherHour {
  /** validTime, epoch ms. */
  t: number;
  temp?: number;
  wind?: number;
}

export interface iCityWeatherDay {
  /** Local-ish calendar day, `YYYY-MM-DD` (UTC-derived). */
  date: string;
  hi?: number;
  lo?: number;
  rain?: number;
  gust?: number;
}

export interface iCityWeatherNow {
  temp?: number;
  wind?: number;
  rain?: number;
}

export interface iCityWeather extends iGeneralModel {
  /** City.id — stable join key. */
  cityId: string;
  name: string;
  cc?: string;
  lat: number;
  lng: number;
  population?: number;
  current?: iCityWeatherNow;
  /** Past ~24h, oldest→newest. */
  hourly?: iCityWeatherHour[];
  /** Next 3 days. */
  daily?: iCityWeatherDay[];
  updatedAt: Date;
}

export interface iCityWeatherModel extends iCityWeather {
  id: string;
  _id: string;
}

const HourSchema = new mongoose.Schema<iCityWeatherHour>(
  { t: { type: Number, required: true }, temp: { type: Number }, wind: { type: Number } },
  { _id: false },
);
const DaySchema = new mongoose.Schema<iCityWeatherDay>(
  {
    date: { type: String, required: true },
    hi: { type: Number },
    lo: { type: Number },
    rain: { type: Number },
    gust: { type: Number },
  },
  { _id: false },
);

const CityWeatherSchema = new mongoose.Schema<iCityWeatherModel>(
  {
    id: { type: String, required: true, unique: true, default: () => uuidv4() },
    cityId: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    cc: { type: String, required: false },
    lat: { type: Number, required: true },
    lng: { type: Number, required: true },
    population: { type: Number, required: false },
    current: {
      type: new mongoose.Schema<iCityWeatherNow>(
        { temp: { type: Number }, wind: { type: Number }, rain: { type: Number } },
        { _id: false },
      ),
      required: false,
    },
    hourly: { type: [HourSchema], required: false },
    daily: { type: [DaySchema], required: false },
    updatedAt: { type: Date, required: true, default: () => new Date() },
  },
  { timestamps: false },
);

CityWeatherSchema.index({ cityId: 1 }, { unique: true, name: "city_weather_city_ix" });

export const getCityWeatherModel = (conn: Connection) =>
  getModel<iCityWeatherModel>(conn, "CityWeather", CityWeatherSchema);
