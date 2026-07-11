"use client";

/** The country + region kinds' favourites pickers. (The ocean kind has no
 *  equivalent here — its sea-point catalog is enabled/disabled directly at
 *  /admin/sea-points, not favourited per scene; see
 *  worker/src/director/candidates.ts.) */
import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import { REGION_SHOTS } from "@photonsurge/shared/director-regions";
import type { DirectorConfig } from "@photonsurge/shared/director";
import CheckboxGrid from "./CheckboxGrid";
import InfoTip from "./InfoTip";

export default function DirectorSpotlights({
  config,
  update,
}: {
  config: DirectorConfig;
  update: (patch: Partial<DirectorConfig>) => void;
}) {
  return (
    <>
      {config.kinds.country ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4, display: "flex", alignItems: "center" }}>
            Favourite countries ({config.countries.length}):
            <InfoTip text="The country kind only spotlights the ones ticked here — tick more to widen its rotation." />
          </div>
          <CheckboxGrid
            items={COUNTRY_SHOTS.map((c) => ({ id: c.id, label: `${c.flag} ${c.name}` }))}
            selected={config.countries}
            onToggle={(id, on) =>
              update({ countries: on ? config.countries.filter((x) => x !== id) : [...config.countries, id] })
            }
          />
        </div>
      ) : null}
      {config.kinds.region ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4, display: "flex", alignItems: "center" }}>
            Favourite areas ({config.regions.length}):
            <InfoTip text="The region kind only spotlights the areas ticked here — continents and land regions (no oceans). Tick more to widen its rotation." />
          </div>
          <CheckboxGrid
            items={REGION_SHOTS.map((r) => ({ id: r.id, label: r.name }))}
            selected={config.regions}
            onToggle={(id, on) =>
              update({ regions: on ? config.regions.filter((x) => x !== id) : [...config.regions, id] })
            }
          />
        </div>
      ) : null}
    </>
  );
}
