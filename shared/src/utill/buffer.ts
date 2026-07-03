/**
 * Normalise a Buffer field read via mongoose `.lean()` to a real Buffer.
 * Lean docs return Buffer paths as a BSON Binary (bytes on `.buffer`, or a
 * `.value()` accessor on newer bson), or occasionally a JSON-serialised
 * `{ type: "Buffer", data: [...] }`. Empty input → empty Buffer.
 */
export function bufferOf(data: unknown): Buffer {
  if (!data) return Buffer.alloc(0);
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof Uint8Array) return Buffer.from(data);

  const d = data as Record<string, unknown>;
  if (d._bsontype === "Binary") {
    if (Buffer.isBuffer(d.buffer) || d.buffer instanceof Uint8Array) {
      return Buffer.from(d.buffer as Uint8Array);
    }
    if (typeof d.value === "function") {
      return Buffer.from((d.value as () => Uint8Array)());
    }
  }
  if (Buffer.isBuffer(d.buffer) || d.buffer instanceof Uint8Array) {
    return Buffer.from(d.buffer as Uint8Array);
  }
  if (Array.isArray(d.data)) {
    return Buffer.from(d.data as number[]);
  }
  return Buffer.alloc(0);
}
