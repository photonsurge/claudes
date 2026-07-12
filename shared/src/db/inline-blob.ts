import type { BlobFs } from "./blob-fs";

/**
 * A blob accessor for collections whose bytes historically lived INLINE on the
 * metadata doc (a `data`/`png` Buffer field), e.g. WeatherTexture, AdminImage,
 * Ad, aurora/geomag/satimg. It externalises those bytes to the shared
 * `${BLOB_DIR}` folder keyed by the doc id, while remaining model-agnostic:
 *
 *  - read:  {@link InlineBlobStore.get} is FS-first; if the blob hasn't been
 *           migrated yet the caller passes the still-inline bytes it already
 *           fetched with the doc, so nothing 404s mid-migration.
 *  - write: call sites `create`/`upsert` the metadata doc with the byte field set
 *           to {@link InlineBlobStore.inlineValue} (the bytes when FS is off, else
 *           `undefined`), then `put` the bytes — so a fresh write never doubles up.
 *  - drop:  the migration `$unset`s the inline field once bytes are safely on disk.
 *
 * With no {@link BlobFs} it degrades to the historical behaviour: bytes stay on
 * the doc, `get` just returns the inline fallback, `put`/`delete` are no-ops.
 */
export interface InlineBlobStore {
  readonly fs: BlobFs | null;
  readonly ns: string;
  /** Bytes for a doc id: FS-first, else the caller's already-fetched inline value. */
  get(id: string, inline?: unknown): Promise<Buffer | null>;
  /** Persist bytes to disk (no-op when FS is off — the doc holds them inline). */
  put(id: string, data: Buffer): Promise<void>;
  /** Remove the on-disk bytes for these ids (paired with a doc delete/$unset). */
  delete(ids: string[]): Promise<void>;
  /** The value to store in the doc's byte field: the bytes (FS off) or `undefined` (FS on). */
  inlineValue(data: Buffer): Buffer | undefined;
}

export function makeInlineBlobStore(ns: string, fs: BlobFs | null): InlineBlobStore {
  return {
    fs,
    ns,
    async get(id: string, inline?: unknown): Promise<Buffer | null> {
      if (fs) {
        const onDisk = await fs.get(ns, id);
        if (onDisk) return onDisk;
      }
      if (inline != null) {
        const b = toBuffer(inline);
        if (b.byteLength) return b;
      }
      return null;
    },
    async put(id: string, data: Buffer): Promise<void> {
      if (fs) await fs.put(ns, id, data);
    },
    async delete(ids: string[]): Promise<void> {
      if (fs && ids.length) await fs.delete(ns, ids);
    },
    inlineValue(data: Buffer): Buffer | undefined {
      return fs ? undefined : data;
    },
  };
}

/**
 * Normalise a value that may be a Buffer, a Uint8Array, or a mongoose `.lean()`
 * BSON Binary into a real Buffer. Centralised so every blob read path decodes
 * the same way. Returns an empty Buffer for anything unrecognised.
 */
export function toBuffer(data: unknown): Buffer {
  if (!data) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);

  const d = data as Record<string, unknown>;
  // mongoose `.lean()` returns Buffer fields as a BSON Binary: the bytes live on
  // `.buffer` (and a `.value()` accessor exists on newer bson).
  if (d._bsontype === "Binary") {
    if (Buffer.isBuffer(d.buffer) || d.buffer instanceof Uint8Array) {
      return Buffer.from(d.buffer as Uint8Array);
    }
    if (typeof d.value === "function") {
      return Buffer.from((d.value as () => Uint8Array)());
    }
  }
  // Some bson versions expose a Buffer/Uint8Array directly on `.buffer`.
  if (Buffer.isBuffer(d.buffer) || d.buffer instanceof Uint8Array) {
    return Buffer.from(d.buffer as Uint8Array);
  }
  // `{ type: "Buffer", data: [...] }` (JSON-serialised Buffer).
  if (Array.isArray(d.data)) {
    return Buffer.from(d.data as number[]);
  }
  return Buffer.alloc(0);
}
