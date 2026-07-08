"use client";

/** The named-location spotlights two kinds rotate through: countries (its
 *  own kind) and sea points (alongside the ocean kind's global spin — see
 *  shared/director-sea-points). */
import { COUNTRY_SHOTS } from "@photonsurge/shared/director-countries";
import { SEA_POINTS } from "@photonsurge/shared/director-sea-points";
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

      {config.kinds.ocean ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 4, display: "flex", alignItems: "center" }}>
            Favourite sea points ({config.seaPoints.length}):
            <InfoTip text="Named locations the ocean kind visits alongside its global spin." />
          </div>
          <CheckboxGrid
            items={SEA_POINTS.map((p) => ({ id: p.id, label: p.name }))}
            selected={config.seaPoints}
            onToggle={(id, on) =>
              update({ seaPoints: on ? config.seaPoints.filter((x) => x !== id) : [...config.seaPoints, id] })
            }
          />
        </div>
      ) : null}
    </>
  );
}
