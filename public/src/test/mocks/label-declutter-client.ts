/** jest stub for components/label-declutter-client (the real one uses import.meta.url):
 *  no worker → GlobeLabels declutters inline, as before. */
import type { Declutterer } from "../../components/label-declutter-client";
export type { Declutterer };
export function createDeclutterer(): Declutterer | null {
  return null;
}
