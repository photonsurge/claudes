import type { FilterQuery, Model } from "mongoose";
import type { tGeneralResponse } from "../interfaces/tGeneralResponse";
import type { iWeatherTextureModel } from "./weather-texture-model";
import type { InlineBlobStore } from "./inline-blob";
import { mongoCrud } from "./mongoose-generic";

/**
 * WeatherTexture persistence. The heaviest blob collection — one PNG/GeoTIFF per
 * (run, variable, forecast hour), re-baked every run and pruned by retention — so
 * it's the biggest win from moving bytes off Mongo onto the shared `${BLOB_DIR}`
 * folder. It wraps the generic {@link mongoCrud} (still exposing getByID/getAll/…)
 * and only specialises the three byte-touching paths:
 *
 *  - `create` writes the bytes to disk and stores `undefined` on the doc (FS-on),
 *  - `getBytes` reads disk-first with the inline value as the migration fallback,
 *  - `deleteMany` drops the on-disk bytes for the matched docs before removing them,
 *    so retention/clear/reingest never leave orphaned texture files behind.
 *
 * `getByID` is inherited unchanged and returns metadata only (no bytes when
 * FS-backed) — byte consumers must call `getBytes`.
 */
export function makeWeatherTextureRepo(
  model: Model<iWeatherTextureModel>,
  blobs: InlineBlobStore,
) {
  const base = mongoCrud<iWeatherTextureModel>(model);

  return {
    ...base,

    /** Create a texture, writing its bytes to disk (FS-backed) and off the doc. */
    async create(
      input: Partial<iWeatherTextureModel>,
    ): Promise<tGeneralResponse<iWeatherTextureModel>> {
      const bytes = input.data ? (input.data as Buffer) : undefined;
      const res = await base.create({ ...input, data: bytes ? blobs.inlineValue(bytes) : undefined });
      if (res.success && res.data && bytes && bytes.length) {
        await blobs.put(res.data.id, bytes);
      }
      return res;
    },

    /** The texture's PNG/GeoTIFF bytes — FS-first, inline fallback — or null. */
    async getBytes(id: string): Promise<{ data: Buffer; contentType: string } | null> {
      const doc = await model
        .findOne({ id } as FilterQuery<iWeatherTextureModel>)
        .lean<Pick<iWeatherTextureModel, "data" | "contentType">>();
      if (!doc) return null;
      const data = await blobs.get(id, doc.data);
      if (!data || !data.length) return null;
      return { data, contentType: doc.contentType || "image/png" };
    },

    /** Delete matching textures, dropping their on-disk bytes first when FS-backed. */
    async deleteMany(
      query: FilterQuery<iWeatherTextureModel>,
    ): Promise<tGeneralResponse<{ count: number }>> {
      if (blobs.fs) {
        const doomed = await model
          .find(query)
          .select({ id: 1, _id: 0 })
          .lean<{ id: string }[]>();
        await blobs.delete(doomed.map((d) => d.id));
      }
      return base.deleteMany(query);
    },
  };
}

export type WeatherTextureRepo = ReturnType<typeof makeWeatherTextureRepo>;
