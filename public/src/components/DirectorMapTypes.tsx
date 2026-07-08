"use client";

/** Which basemap "map types" each touring kind (global spin/ocean/quake)
 *  cycles through while it's on air — unticking one just removes it from
 *  that kind's rotation, it doesn't disable the kind itself (see DirectorHolds
 *  for that). An empty selection for a kind means "all enabled". */
import { INTRO_MAP_TYPES, OCEAN_MAP_TYPES, QUAKE_MAP_TYPES, type GlobalMapType } from "@photonsurge/shared/director-rois";
import type { DirectorConfig, SegmentKind } from "@photonsurge/shared/director";
import InfoTip from "./InfoTip";

const TOURED_KINDS: { kind: SegmentKind; label: string; catalog: GlobalMapType[] }[] = [
  { kind: "intro", label: "Global spin (intro)", catalog: INTRO_MAP_TYPES },
  { kind: "ocean", label: "Ocean spin", catalog: OCEAN_MAP_TYPES },
  { kind: "quake", label: "Earthquake terrain looks", catalog: QUAKE_MAP_TYPES },
];

function enabledMapTypeIds(config: DirectorConfig, kind: SegmentKind, catalog: GlobalMapType[]): string[] {
  const ids = config.mapTypes[kind];
  return ids && ids.length ? ids : catalog.map((t) => t.id);
}

export default function DirectorMapTypes({
  config,
  update,
}: {
  config: DirectorConfig;
  update: (patch: Partial<DirectorConfig>) => void;
}) {
  const toured = TOURED_KINDS.filter((t) => config.kinds[t.kind]);
  if (!toured.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6, display: "flex", alignItems: "center" }}>
        Map types shown:
        <InfoTip text="Each of these kinds spins through several basemap looks while on air. Untick a look to take it out of that kind's rotation." />
      </div>
      {toured.map(({ kind, label, catalog }) => {
        const enabled = enabledMapTypeIds(config, kind, catalog);
        return (
          <div key={kind} style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 11, opacity: 0.6, marginBottom: 2 }}>{label}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 12px" }}>
              {catalog.map((t) => {
                const on = enabled.includes(t.id);
                return (
                  <label key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() =>
                        update({
                          mapTypes: {
                            ...config.mapTypes,
                            [kind]: on ? enabled.filter((id) => id !== t.id) : [...enabled, t.id],
                          },
                        })
                      }
                    />
                    {t.title}
                  </label>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
