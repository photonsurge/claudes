"use client";

/**
 * Generate now: pick a crossword channel (the build honours its difficulty and
 * no-repeat window) and optionally a theme, then queue `crossword.generate`.
 * The job runs in the background, so success only says it was queued; the
 * puzzle shows in the list when it lands.
 */
import { useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { sceneSurface, type SceneMeta } from "@photonsurge/shared/control";
import { listScenes } from "../../../../lib/scenes";
import { generatePuzzle } from "./api";

interface Props {
  /** Called once a build is queued (the page refreshes later). */
  onQueued?: () => void;
  /** Injectable for tests. */
  loadScenes?: () => Promise<SceneMeta[]>;
  generate?: typeof generatePuzzle;
}

export default function GenerateForm({ onQueued, loadScenes = listScenes, generate = generatePuzzle }: Props) {
  const [scenes, setScenes] = useState<SceneMeta[] | null>(null);
  const [sceneId, setSceneId] = useState("");
  const [theme, setTheme] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    loadScenes().then((all) => {
      if (!live) return;
      const xw = all.filter((s) => sceneSurface(s) === "crossword");
      setScenes(xw);
      setSceneId((cur) => cur || xw[0]?.id || "");
    });
    return () => {
      live = false;
    };
  }, [loadScenes]);

  const submit = async () => {
    setBusy(true);
    setError(null);
    setDone(null);
    const res = await generate(sceneId, theme);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setDone(`Build queued${theme.trim() ? ` (theme: ${theme.trim()})` : ""}. It appears below when it lands.`);
    onQueued?.();
  };

  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        Generate now
      </Typography>
      {scenes && !scenes.length ? (
        <Typography color="text.secondary" sx={{ mt: 1 }}>
          No crossword channels yet. Create one on the Channels page first.
        </Typography>
      ) : (
        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25} sx={{ mt: 1, alignItems: { sm: "center" } }}>
          <TextField
            select
            size="small"
            label="Channel"
            value={sceneId}
            onChange={(e) => setSceneId(e.target.value)}
            sx={{ minWidth: 220 }}
            disabled={!scenes}
          >
            {(scenes ?? []).map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Theme (optional)"
            placeholder="Volcanoes"
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            slotProps={{ htmlInput: { maxLength: 60 } }}
            sx={{ minWidth: 220 }}
          />
          <Button variant="contained" onClick={submit} disabled={busy || !sceneId}>
            Generate
          </Button>
        </Stack>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1.25 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {done && (
        <Alert severity="success" sx={{ mt: 1.25 }} onClose={() => setDone(null)}>
          {done}
        </Alert>
      )}
    </Paper>
  );
}
