/** jest stub for lib/high-low-client (the real one uses import.meta.url):
 *  no worker → high-low-labels.ts runs the scan on the (test) main thread. */
import type { HighLowFinder } from "../../lib/high-low-client";
export type { HighLowFinder };
export function createHighLowFinder(): HighLowFinder | null {
  return null;
}
