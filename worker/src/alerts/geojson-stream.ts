// alerts/geojson-stream.ts
//
// Zero-dep incremental extraction of the elements of ONE top-level array (e.g.
// GeoJSON's `"features": [...]`) from a streaming HTTP body, yielding each
// element parsed, WITHOUT ever materialising the whole response as a string or
// the whole collection as one parsed tree.
//
// Why: the WMO WFS snapshot is a multi-MB FeatureCollection (up to 30k
// features). `res.text()` + `JSON.parse` holds body string + full tree + the
// mapped output simultaneously — a few hundred MB of transient heap per poll,
// which is exactly the sawtooth that squeezes an 8GB box. Streaming holds one
// feature at a time plus whatever the caller accumulates.
//
// How: a minimal JSON scanner — string/escape state plus a container stack. It
// only *tokenises* structure; each captured element is handed to the real
// `JSON.parse`, so there is no hand-rolled value parsing to get subtly wrong.
// Non-object elements of the target array (not a thing in GeoJSON) are skipped.
//
// Event-loop manners: work happens in per-chunk slices (network-sized, ~64KB),
// with an await between chunks — a full 100MB body never runs as one
// synchronous scan (see the never-block-the-main-thread rule in WORKER.md).

const isWS = (c: string) => c === " " || c === "\t" || c === "\n" || c === "\r";

/**
 * Yield each object element of the top-level array named `key` (a direct
 * property of the root object). Throws if the stream ends without that array —
 * for a reconcile-snapshot feed a malformed response MUST fail the tick loudly
 * rather than parse as "zero active warnings" and deactivate everything.
 *
 * The rest of the body after the target array closes is not read (the reader is
 * cancelled), which also frees the socket early.
 */
export async function* streamTopLevelArray(
  body: ReadableStream<Uint8Array>,
  key: string,
): AsyncGenerator<unknown, void, undefined> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");

  const stack: ("O" | "A")[] = [];
  let inString = false;
  let escaped = false;
  // Root-level key tracking: record strings that appear directly inside the
  // root object, and whether the next non-whitespace char makes one a key.
  let trackString = false;
  let str = "";
  let awaitingColon: string | null = null;
  let pendingKey: string | null = null;

  let inTarget = false; // inside the `key` array
  let targetDepth = 0; // stack.length while directly inside it
  let capturing = false; // inside one element object of it
  let parts: string[] = []; // captured element text, in chunk-sized slices
  let sliceStart = 0;
  let found = false;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      const chunk = decoder.decode(value ?? new Uint8Array(), { stream: !done });
      sliceStart = 0;

      for (let i = 0; i < chunk.length; i++) {
        const c = chunk[i];

        if (inString) {
          if (escaped) escaped = false;
          else if (c === "\\") escaped = true;
          else if (c === '"') {
            inString = false;
            if (trackString) {
              awaitingColon = str;
              trackString = false;
            }
          } else if (trackString) str += c;
          continue;
        }

        // A root-level string just closed: is it a key ("features":) or a value?
        if (awaitingColon !== null && !isWS(c)) {
          pendingKey = c === ":" ? awaitingColon : null;
          awaitingColon = null;
          if (c === ":") continue;
        }

        switch (c) {
          case '"':
            inString = true;
            escaped = false;
            if (stack.length === 1 && stack[0] === "O" && !inTarget) {
              trackString = true;
              str = "";
            }
            break;
          case "{":
            if (inTarget && !capturing && stack.length === targetDepth) {
              capturing = true;
              parts = [];
              sliceStart = i;
            }
            stack.push("O");
            pendingKey = null;
            break;
          case "[":
            if (!inTarget && stack.length === 1 && stack[0] === "O" && pendingKey === key) {
              inTarget = true;
              found = true;
              stack.push("A");
              targetDepth = stack.length;
            } else stack.push("A");
            pendingKey = null;
            break;
          case "}":
            stack.pop();
            if (capturing && stack.length === targetDepth) {
              parts.push(chunk.slice(sliceStart, i + 1));
              capturing = false;
              yield JSON.parse(parts.join(""));
              parts = [];
            }
            break;
          case "]":
            stack.pop();
            if (inTarget && stack.length === targetDepth - 1) {
              // Target array closed — nothing else in the body matters.
              return;
            }
            break;
          default:
            break;
        }
      }

      if (capturing && sliceStart < chunk.length) parts.push(chunk.slice(sliceStart));
      if (done) break;
    }
  } finally {
    reader.cancel().catch(() => {});
  }

  if (!found) throw new Error(`streaming parse: no top-level "${key}" array in response`);
  throw new Error(`streaming parse: response ended inside "${key}" array (truncated body)`);
}
