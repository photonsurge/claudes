"use client";

/**
 * On-air card for the GVP CATALOG facts about a volcano — type, landform, tectonic
 * setting, rock types, epoch, and the Smithsonian's own geology write-up.
 *
 * All of it rides the one focus call on the `volcano` itself (the catalog seed
 * fills these fields for every volcano, dormant included), so there's no fetch and
 * no dependence on the volcano being promoted or in this week's bulletin. Returns
 * null when the catalog seed hasn't run, so callers check
 * `volcanoGeologySlideHasContent` first.
 */
import type { Volcano } from "@photonsurge/shared/volcanoes/types";
import BroadcastCard, { CardSection } from "./BroadcastCard";

/** Trim GVP's prose to something readable on air without cutting mid-word. */
const clip = (text: string, max = 260): string => {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
};

export function volcanoGeologySlideHasContent(v: Volcano | undefined): boolean {
  return Boolean(v && (v.geologicalSummary || v.tectonicSetting || v.majorRockTypes?.length || v.volcanoType));
}

export default function VolcanoGeologyPanel({ volcano: v, color = "#f97316" }: { volcano?: Volcano; color?: string }) {
  if (!volcanoGeologySlideHasContent(v)) return null;
  const vol = v!;

  const facts: [string, string][] = [];
  if (vol.volcanoType) facts.push(["Type", vol.volcanoType]);
  if (vol.elevationM != null) facts.push(["Summit", `${vol.elevationM.toLocaleString()} m`]);
  if (vol.tectonicSetting) facts.push(["Setting", vol.tectonicSetting]);
  if (vol.majorRockTypes?.length) facts.push(["Rock", vol.majorRockTypes.slice(0, 2).join(" · ")]);
  if (vol.lastEruptionYear != null) facts.push(["Last eruption", String(vol.lastEruptionYear)]);

  return (
    <BroadcastCard accent={color} eyebrow="Geology">
      <CardSection first eyebrow={vol.subregion || vol.region || "Smithsonian GVP"}>
        {facts.length > 0 && (
          <table style={{ fontSize: 12, borderCollapse: "collapse", width: "100%" }}>
            <tbody>
              {facts.map(([k, val]) => (
                <tr key={k}>
                  <td style={{ color: "#5b6478", padding: "2px 10px 2px 0", whiteSpace: "nowrap", verticalAlign: "top" }}>{k}</td>
                  <td style={{ color: "#e2e8f0", padding: "2px 0" }}>{val}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {vol.geologicalSummary && (
          <p style={{ color: "#8ea3bf", fontSize: 11, lineHeight: 1.5, margin: "7px 0 0" }}>{clip(vol.geologicalSummary)}</p>
        )}
      </CardSection>
    </BroadcastCard>
  );
}
