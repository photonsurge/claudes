import { streamTopLevelArray } from "./geojson-stream";

/** A ReadableStream that serves `text` in chunks of `size` chars (UTF-8 encoded). */
function chunked(text: string, size: number): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= text.length) return controller.close();
      controller.enqueue(enc.encode(text.slice(at, at + size)));
      at += size;
    },
  });
}

/** A ReadableStream that serves the raw BYTES in chunks (can split multibyte chars). */
function byteChunked(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let at = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (at >= bytes.length) return controller.close();
      controller.enqueue(bytes.slice(at, at + size));
      at += size;
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>, key = "features"): Promise<unknown[]> {
  const out: unknown[] = [];
  for await (const el of streamTopLevelArray(body, key)) out.push(el);
  return out;
}

const FEATURES = [
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [[[0, 0], [1, 0], [1, 1], [0, 0]]] },
    properties: { capurl: "cn-cma-xx/2026/x1", event: 'Rain, with "heavy" bursts \\ hail', s: 3 },
  },
  {
    type: "Feature",
    geometry: {
      type: "MultiPolygon",
      coordinates: [[[[10, 10], [11, 10], [11, 11], [10, 10]]], [[[20, 20], [21, 20], [21, 21], [20, 20]]]],
    },
    properties: { capurl: "ru-mch/2026/x2", nested: { deep: [{ a: [1, 2, { b: "}]" }] }] }, s: 1 },
  },
  { type: "Feature", geometry: null, properties: { capurl: "jp-jma/2026/x3", note: "no geometry ]}" } },
];

const DOC = JSON.stringify({
  type: "FeatureCollection",
  totalFeatures: 3,
  features: FEATURES,
  crs: { type: "name", properties: { name: "urn:ogc:def:crs:EPSG::4326", features: ["decoy"] } },
});

describe("streamTopLevelArray", () => {
  it("yields every feature, parsed identically to JSON.parse, for many chunk sizes", async () => {
    for (const size of [1, 2, 3, 7, 16, 64, 1024, DOC.length]) {
      expect(await collect(chunked(DOC, size))).toEqual(FEATURES);
    }
  });

  it("survives chunk boundaries splitting multibyte UTF-8 characters", async () => {
    const doc = JSON.stringify({ features: [{ properties: { name: "Ævarsstaðir — 東京 ☔" } }] });
    const bytes = new TextEncoder().encode(doc);
    for (const size of [1, 2, 3, 5]) {
      expect(await collect(byteChunked(bytes, size))).toEqual([{ properties: { name: "Ævarsstaðir — 東京 ☔" } }]);
    }
  });

  it("ignores arrays under other keys and nested 'features' keys", async () => {
    const doc = JSON.stringify({
      bbox: [1, 2, 3, 4],
      meta: { features: [{ decoy: true }] },
      name: "features",
      features: [{ real: 1 }],
    });
    expect(await collect(chunked(doc, 5))).toEqual([{ real: 1 }]);
  });

  it("handles an empty features array", async () => {
    expect(await collect(chunked(JSON.stringify({ features: [], totalFeatures: 0 }), 3))).toEqual([]);
  });

  it("stops reading after the target array closes (trailing junk never parsed)", async () => {
    // Invalid JSON after the features array — must not matter.
    const doc = `{"features":[{"a":1}],"trailing":INVALID!!}`;
    expect(await collect(chunked(doc, 4))).toEqual([{ a: 1 }]);
  });

  it("throws when there is no top-level target array (e.g. a GeoServer exception doc)", async () => {
    const doc = JSON.stringify({ exception: "ServiceUnavailable", detail: "boom" });
    await expect(collect(chunked(doc, 8))).rejects.toThrow(/no top-level "features" array/);
  });

  it("throws on a body truncated mid-array, instead of yielding a silently-short list", async () => {
    const full = JSON.stringify({ features: [{ a: 1 }, { b: 2 }] });
    const doc = full.slice(0, full.indexOf('{"b"') + 3);
    await expect(collect(chunked(doc, 6))).rejects.toThrow(/truncated/);
  });

  it("skips non-object elements of the target array", async () => {
    const doc = `{"features":[1,"x",null,{"ok":true},[2,3],{"ok":2}]}`;
    expect(await collect(chunked(doc, 5))).toEqual([{ ok: true }, { ok: 2 }]);
  });
});
