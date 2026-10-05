/**
 * Pure place and scope labels for scripted short videos — no React, so API
 * routes can import them (a route importing lib/shorts.ts, which holds the
 * page's hooks, fails the production build). lib/shorts.ts re-exports these.
 */
import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import { REGION_SHOTS } from "@photonsurge/shared/director-regions";
import { shortPlaceName, type ShortPlace, type ShortScope } from "@photonsurge/shared/short-script";

const countryById = new Map(COUNTRY_SHOTS.map((c) => [c.id, c]));
const regionById = new Map(REGION_SHOTS.map((r) => [r.id, r]));

/** "🇺🇸 United States" / "Europe" — one place as the pickers show it. */
export function placeLabel(p: ShortPlace): string {
  const c = p.type === "country" ? countryById.get(p.id) : undefined;
  return c ? `${c.flag} ${c.name}` : shortPlaceName(p);
}

/** "Globe" / "Area · Northern Europe" / "Country · 🇯🇵 Japan" (raw id when the
 *  catalog no longer knows it) / "6 places · Europe, United States, …". */
export function scopeLabel(scope: ShortScope): string {
  if (scope.type === "globe") return "Globe";
  if (scope.type === "places") {
    const names = scope.places.map(shortPlaceName);
    const shown = names.length > 3 ? `${names.slice(0, 3).join(", ")}, …` : names.join(", ");
    return `${names.length} place${names.length === 1 ? "" : "s"} · ${shown}`;
  }
  if (scope.type === "area") return `Area · ${regionById.get(scope.id)?.name ?? scope.id}`;
  const c = countryById.get(scope.id);
  return `Country · ${c ? `${c.flag} ${c.name}` : scope.id}`;
}
