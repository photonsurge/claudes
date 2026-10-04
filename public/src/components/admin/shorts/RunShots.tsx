"use client";

/**
 * A video render's OBS screenshots (docs/short-video-plan.md §7 "Evidence"):
 * one small thumbnail per clip, each linking to the full-size image. A clip
 * whose capture failed shows its reason instead. Used on the Renders row of
 * an offline test and on the run page /admin/streams/:id.
 */
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import type { RunShot } from "@photonsurge/shared/runs";
import { shotUrl } from "../../../lib/renders";

export default function RunShots({ shots, height = 54 }: { shots: RunShot[] | null | undefined; height?: number }) {
  if (!shots?.length) return null;
  return (
    <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }} aria-label="OBS screenshots">
      {shots.map((s) => {
        const label = `Clip ${s.clipIndex + 1}`;
        if (!s.blobId) {
          return (
            <Tooltip key={s.clipIndex} title={s.error ?? "no image"}>
              <Box
                sx={{
                  height,
                  width: Math.round((height * 16) / 9),
                  border: 1,
                  borderColor: "divider",
                  borderRadius: 0.5,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Typography variant="caption" color="error">
                  {label}: no image
                </Typography>
              </Box>
            </Tooltip>
          );
        }
        return (
          <Tooltip key={s.clipIndex} title={`${label}, as OBS drew it at ${new Date(s.at).toLocaleTimeString()}`}>
            <a href={shotUrl(s.blobId)} target="_blank" rel="noreferrer" aria-label={`${label} screenshot`}>
              {/* eslint-disable-next-line @next/next/no-img-element -- an admin-only blob, not a static asset */}
              <img
                src={shotUrl(s.blobId)}
                alt={`${label} as OBS drew it`}
                loading="lazy"
                style={{ height, width: "auto", display: "block", borderRadius: 4 }}
              />
            </a>
          </Tooltip>
        );
      })}
    </Stack>
  );
}
