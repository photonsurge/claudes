"use client";

/**
 * The report deck's named point forecasts: up to four labelled lat/lng pairs the
 * weather slide cycles. With none set the slide follows the live camera instead.
 * "Add current view" seeds one from wherever the channel's camera is parked.
 */
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { type WeatherLocation } from "@photonsurge/shared/control";

const MAX_LOCATIONS = 4;

export default function ReportLocationsField({
  locations,
  camera,
  onChange,
}: {
  locations: WeatherLocation[];
  camera: { center: [number, number] | number[] };
  onChange: (next: WeatherLocation[]) => void;
}) {
  const update = (index: number, over: Partial<WeatherLocation>) =>
    onChange(locations.map((l, i) => (i === index ? { ...l, ...over } : l)));

  const add = () => {
    if (locations.length >= MAX_LOCATIONS) return;
    onChange([
      ...locations,
      {
        label: `Location ${locations.length + 1}`,
        lat: Number(camera.center[1].toFixed(3)),
        lng: Number(camera.center[0].toFixed(3)),
      },
    ]);
  };

  return (
    <Box sx={{ mt: 1.75, mb: 1.75, pt: 1.5, borderTop: 1, borderColor: "divider" }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 0.5 }}>
        <Typography variant="subtitle2" sx={{ flex: 1 }}>
          Weather locations
        </Typography>
        <Button size="small" disabled={locations.length >= MAX_LOCATIONS} onClick={add}>
          Add current view
        </Button>
      </Stack>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 1 }}>
        Up to four named point forecasts. With none selected, the slide follows the live camera.
      </Typography>
      <Stack spacing={1}>
        {locations.map((location, index) => (
          <Stack key={index} direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ alignItems: "center" }}>
            <TextField
              size="small"
              fullWidth
              label={`Location ${index + 1} name`}
              value={location.label}
              onChange={(event) => update(index, { label: event.target.value })}
              slotProps={{ htmlInput: { "aria-label": `Weather location ${index + 1} name` } }}
            />
            <TextField
              size="small"
              type="number"
              label="Latitude"
              value={location.lat}
              onChange={(event) => update(index, { lat: Number(event.target.value) })}
              slotProps={{ htmlInput: { "aria-label": `Weather location ${index + 1} latitude`, min: -90, max: 90, step: 0.001 } }}
              sx={{ width: { xs: "100%", sm: 150 } }}
            />
            <TextField
              size="small"
              type="number"
              label="Longitude"
              value={location.lng}
              onChange={(event) => update(index, { lng: Number(event.target.value) })}
              slotProps={{ htmlInput: { "aria-label": `Weather location ${index + 1} longitude`, min: -180, max: 180, step: 0.001 } }}
              sx={{ width: { xs: "100%", sm: 150 } }}
            />
            <Button size="small" color="error" onClick={() => onChange(locations.filter((_, i) => i !== index))}>
              Remove
            </Button>
          </Stack>
        ))}
      </Stack>
    </Box>
  );
}
