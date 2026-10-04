"use client";

/**
 * The director-mode chip in the DirectorSettings card header. Read-only for
 * Off / Auto (the toggle stays on /control). A scene playing a scripted short
 * ("script" mode) reads "Playing a script" with a Stop button — the one live
 * action here, so it PATCHes `mode: "off"` straight away instead of staging
 * through the Save bar; the worker's runner sees the scene leave script mode
 * and stands down. The stop is remembered locally so the chip reads Off
 * without waiting for a refetch of the page's draft base.
 */
import { useState } from "react";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import Tooltip from "@mui/material/Tooltip";
import type { DirectorMode } from "@photonsurge/shared/director";
import { patchDirectorConfig } from "../../../lib/director";

export default function DirectorModeChip({ sceneId, mode }: { sceneId: string; mode: DirectorMode }) {
  const [stopping, setStopping] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const shown = stopped ? "off" : mode;

  if (shown !== "script") {
    return (
      <Chip
        size="small"
        label={shown === "auto" ? "Auto" : "Off"}
        color={shown === "auto" ? "success" : "default"}
        variant="outlined"
      />
    );
  }

  const stop = () => {
    setStopping(true);
    setError(null);
    patchDirectorConfig(sceneId, { mode: "off" })
      .then(() => setStopped(true))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setStopping(false));
  };

  return (
    <Stack direction="row" spacing={0.75} sx={{ alignItems: "center" }}>
      <Chip size="small" label="Playing a script" color="info" variant="outlined" />
      <Tooltip describeChild title={error ?? "Stop the script — the director goes off"}>
        {/* span: a disabled button fires no events for the tooltip to hang off */}
        <span>
          <Button size="small" color={error ? "error" : "inherit"} onClick={stop} disabled={stopping}>
            Stop
          </Button>
        </span>
      </Tooltip>
    </Stack>
  );
}
