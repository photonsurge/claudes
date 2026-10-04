"use client";

/**
 * Chat commands → "Viewers may steer the director": map-look requests and
 * camera requests (`:show japan`, `:quake`, `:roundup uk`). Requests queue
 * through the director's command queue, behind the operator and breaking news.
 */
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import type { ChatCommandSettings } from "@photonsurge/shared/chat-policy";
import type { SegmentKind } from "@photonsurge/shared/director";
import { INTRO_MAP_TYPES, OCEAN_MAP_TYPES } from "@photonsurge/shared/director-rois";
import { KIND_LABEL } from "../../../lib/kind-labels";
import TuningField from "./TuningField";
import Gated from "./Gated";

const row = { display: "flex", flexWrap: "wrap", gap: 1.5, mb: 1.5, alignItems: "center" } as const;
const REQUESTABLE: SegmentKind[] = ["quake", "storm", "volcano", "flight", "ship", "ocean", "orbital", "global"];
const LOOKS = [...new Map([...INTRO_MAP_TYPES, ...OCEAN_MAP_TYPES].map((t) => [t.id, t])).values()];

export default function ChatDirectorPolicy({
  policy,
  set,
}: {
  policy: ChatCommandSettings;
  set: (over: Partial<ChatCommandSettings>) => void;
}) {
  const d = policy.director;
  const m = policy.mapType;
  const setD = (over: Partial<ChatCommandSettings["director"]>) => set({ director: { ...d, ...over } });
  const setM = (over: Partial<ChatCommandSettings["mapType"]>) => set({ mapType: { ...m, ...over } });
  const check = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <FormControlLabel key={label} label={label} control={<Checkbox size="small" checked={checked} onChange={(e) => onChange(e.target.checked)} />} />
  );

  return (
    <>
      <Typography variant="subtitle2" sx={{ mt: 1 }}>Map looks</Typography>
      <FormControlLabel control={<Switch checked={m.enabled} onChange={(e) => setM({ enabled: e.target.checked })} />} label="Viewers may pick the map look (:mode aurora)" />
      <Gated off={!m.enabled} reason="Map-look requests are off.">
        <Box sx={row} role="group" aria-label="Map looks viewers may pick">
          {LOOKS.map((t) => {
            const all = m.allowed.length === 0;
            return check(t.title, all || m.allowed.includes(t.id), (on) => {
              const current = all ? LOOKS.map((x) => x.id) : m.allowed;
              const next = on ? [...new Set([...current, t.id])] : current.filter((x) => x !== t.id);
              if (next.length) setM({ allowed: next.length === LOOKS.length ? [] : next });
            });
          })}
        </Box>
        <Box sx={row}>
          <TuningField label="Look hold" unit="s" value={m.holdS} defaultValue={300} min={10} max={m.maxHoldS} onChange={(v) => setM({ holdS: v })} />
          <TuningField label="Longest look hold" unit="s" value={m.maxHoldS} defaultValue={900} min={10} max={7200} onChange={(v) => setM({ maxHoldS: v, holdS: Math.min(m.holdS, v) })} />
        </Box>
        <Typography variant="caption" color="text.secondary" component="div" sx={{ mb: 1.5 }}>
          A look waits for the next shot change, then parks the world spin on it.
        </Typography>
      </Gated>

      <Typography variant="subtitle2" sx={{ mt: 1 }}>The camera</Typography>
      <FormControlLabel control={<Switch checked={d.enabled} onChange={(e) => setD({ enabled: e.target.checked })} />} label="Viewers may steer the director" />
      <Gated off={!d.enabled} reason="Viewers can't move the camera on this channel; the operator's own commands are unaffected.">
        <RadioGroup row value={d.mode} onChange={(e) => setD({ mode: e.target.value as "boundary" | "immediate" })} aria-label="When a viewer request airs">
          <FormControlLabel value="boundary" control={<Radio size="small" />} label="At the next shot change" />
          <FormControlLabel value="immediate" control={<Radio size="small" />} label="Straight away" />
        </RadioGroup>
        <Box sx={row} role="group" aria-label="Viewer requests allowed">
          {check(":show <place>", d.ops.cut, (v) => setD({ ops: { ...d.ops, cut: v } }))}
          {check(":roundup", d.ops.roundup, (v) => setD({ ops: { ...d.ops, roundup: v } }))}
          {check(":next (mods)", d.ops.skip, (v) => setD({ ops: { ...d.ops, skip: v } }))}
          {check(":clear (mods)", d.ops.clear, (v) => setD({ ops: { ...d.ops, clear: v } }))}
        </Box>
        <Box sx={row} role="group" aria-label="Places viewers may ask for">
          {check("Countries", d.places.countries, (v) => setD({ places: { ...d.places, countries: v } }))}
          {check("Areas", d.places.regions, (v) => setD({ places: { ...d.places, regions: v } }))}
          {check("Cities", d.places.cities, (v) => setD({ places: { ...d.places, cities: v } }))}
        </Box>
        <Box sx={row} role="group" aria-label="Kinds of shot viewers may ask for">
          {REQUESTABLE.map((k) => check(KIND_LABEL[k], !!d.kinds[k], (v) => setD({ kinds: { ...d.kinds, [k]: v } })))}
        </Box>
        <Box sx={row}>
          <TuningField label="Request hold" unit="s" value={d.holdS} defaultValue={60} min={10} max={d.maxHoldS} onChange={(v) => setD({ holdS: v })} />
          <TuningField label="Longest request hold" unit="s" value={d.maxHoldS} defaultValue={180} min={10} max={7200} onChange={(v) => setD({ maxHoldS: v, holdS: Math.min(d.holdS, v) })} />
          <TuningField label="At most one viewer cut per" unit="s" value={d.everyS} defaultValue={120} min={0} max={3600} onChange={(v) => setD({ everyS: v })} />
          <TuningField label="Most viewer requests waiting" value={d.maxQueued} defaultValue={5} min={1} max={50} integer onChange={(v) => setD({ maxQueued: v })} />
        </Box>
      </Gated>
    </>
  );
}
