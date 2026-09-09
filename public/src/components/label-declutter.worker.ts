/**
 * Declutter worker: holds the current label index and answers each frame's
 * "which labels, with detail?" off the main thread (see label-declutter.ts).
 * The reply carries the label generation it was computed for; the main thread
 * only uses it while that generation is current.
 */
import { LabelGrid, declutter, type Decision, type FrameParams, type LabelIndexData } from "./label-declutter";

export type DeclutterRequest =
  | { type: "index"; gen: number; data: LabelIndexData }
  | { type: "frame"; gen: number; frame: FrameParams };
export type DeclutterResponse = Decision & { gen: number };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<DeclutterRequest>) => void) | null;
  postMessage(msg: DeclutterResponse, transfer?: Transferable[]): void;
};

let data: LabelIndexData | null = null;
let gen = -1;
const grid = new LabelGrid();

ctx.onmessage = (e) => {
  const msg = e.data;
  if (msg.type === "index") {
    data = msg.data;
    gen = msg.gen;
    return;
  }
  if (!data || msg.gen !== gen) {
    // Answer anyway so the caller's in-flight flag clears; it ignores the generation mismatch.
    ctx.postMessage({ gen: msg.gen, chosen: new Uint32Array(0), detail: new Uint8Array(0), considered: 0, projected: 0 });
    return;
  }
  const d = declutter(data, msg.frame, grid);
  ctx.postMessage({ gen, ...d }, [d.chosen.buffer, d.detail.buffer]);
};
