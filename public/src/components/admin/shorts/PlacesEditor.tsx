"use client";

/**
 * The ordered place list of a several-places video (docs/short-video-plan.md
 * §4): one row per place, in the order the video visits them, each with up,
 * down and remove; an add row (Country or Area, then the place from the shared
 * catalogs); and a "Main areas" quick-fill with the main areas video's six
 * places (plan §1). Countries and areas mix freely. A place already in the
 * list can't be added twice, and the list stops at MAX_SHORT_PLACES — the same
 * rules the sanitiser applies.
 */
import { useState } from "react";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { MAIN_AREAS_PLACES, MAX_SHORT_PLACES, type ShortPlace } from "@photonsurge/shared/short-script";
import { AREA_OPTIONS, COUNTRY_OPTIONS, placeLabel } from "../../../lib/shorts";

interface Props {
  places: ShortPlace[];
  onChange: (places: ShortPlace[]) => void;
  disabled?: boolean;
}

const same = (a: ShortPlace, b: ShortPlace) => a.type === b.type && a.id === b.id;

/** `list` with the item at `i` moved by `by` (-1 up, +1 down); unchanged at an end. */
export function movePlace(list: ShortPlace[], i: number, by: -1 | 1): ShortPlace[] {
  const j = i + by;
  if (i < 0 || i >= list.length || j < 0 || j >= list.length) return list;
  const out = [...list];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

export default function PlacesEditor({ places, onChange, disabled }: Props) {
  const [kind, setKind] = useState<ShortPlace["type"]>("area");
  const options = kind === "country" ? COUNTRY_OPTIONS : AREA_OPTIONS;
  const [pick, setPick] = useState<string>("");
  const full = places.length >= MAX_SHORT_PLACES;
  const candidate: ShortPlace | null = pick ? { type: kind, id: pick } : null;
  const dup = !!candidate && places.some((p) => same(p, candidate));

  const add = () => {
    if (!candidate || dup || full) return;
    onChange([...places, candidate]);
    setPick("");
  };

  return (
    <Stack spacing={1}>
      {places.length ? (
        <Stack component="ol" spacing={0.5} sx={{ m: 0, pl: 3 }} aria-label="Places in order">
          {places.map((p, i) => (
            <li key={`${p.type}:${p.id}`}>
              <Stack direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
                <Typography variant="body2" sx={{ minWidth: 200 }}>
                  {placeLabel(p)}
                  <Typography component="span" variant="caption" color="text.secondary">
                    {" "}
                    · {p.type === "country" ? "country" : "area"}
                  </Typography>
                </Typography>
                <IconButton
                  size="small"
                  aria-label={`Move ${placeLabel(p)} up`}
                  disabled={disabled || i === 0}
                  onClick={() => onChange(movePlace(places, i, -1))}
                >
                  ↑
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={`Move ${placeLabel(p)} down`}
                  disabled={disabled || i === places.length - 1}
                  onClick={() => onChange(movePlace(places, i, 1))}
                >
                  ↓
                </IconButton>
                <IconButton
                  size="small"
                  aria-label={`Remove ${placeLabel(p)}`}
                  disabled={disabled}
                  onClick={() => onChange(places.filter((_, k) => k !== i))}
                >
                  ✕
                </IconButton>
              </Stack>
            </li>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No places yet. Add countries or areas in the order the video visits them.
        </Typography>
      )}

      <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          select
          size="small"
          label="Add a"
          value={kind}
          onChange={(e) => {
            setKind(e.target.value as ShortPlace["type"]);
            setPick("");
          }}
          disabled={disabled || full}
          sx={{ minWidth: 120 }}
        >
          <MenuItem value="area">Area</MenuItem>
          <MenuItem value="country">Country</MenuItem>
        </TextField>
        <TextField
          select
          size="small"
          label={kind === "country" ? "Country to add" : "Area to add"}
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          disabled={disabled || full}
          sx={{ minWidth: 240 }}
        >
          {options.map((o) => (
            <MenuItem key={o.id} value={o.id} disabled={places.some((p) => same(p, { type: kind, id: o.id }))}>
              {o.label}
            </MenuItem>
          ))}
        </TextField>
        <Button variant="outlined" size="small" onClick={add} disabled={disabled || !candidate || dup || full}>
          Add
        </Button>
        <Button
          size="small"
          onClick={() => onChange([...MAIN_AREAS_PLACES])}
          disabled={disabled}
          title="Europe, United States, Asia, Australia, Africa, South America"
        >
          Main areas
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary">
        One round-up per place, in this order, then a world spin. Round-up only: the event switches don&apos;t apply. A
        place with no round-up is left out. Up to {MAX_SHORT_PLACES} places.
      </Typography>
    </Stack>
  );
}
