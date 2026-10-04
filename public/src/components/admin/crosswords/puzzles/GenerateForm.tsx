"use client";

/**
 * Generate now: pick a crossword channel (the build honours its difficulty,
 * no-repeat window and family-friendly setting) and queue `crossword.generate`.
 * The job runs in the background, so after queuing the form polls the list
 * for a new puzzle for about 30 s, then points at the Jobs page.
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
import { generatePuzzle, listPuzzles } from "./api";

interface Props {
  /** Called once a build is queued (the page refreshes later). */
  onQueued?: () => void;
  /** Injectable for tests. */
  loadScenes?: () => Promise<SceneMeta[]>;
  generate?: typeof generatePuzzle;
  list?: typeof listPuzzles;
  /** Poll spacing and total wait, in ms. */
  pollMs?: number;
  waitMs?: number;
}

export default function GenerateForm({ onQueued, loadScenes = listScenes, generate = generatePuzzle, list = listPuzzles, pollMs = 3000, waitMs = 30_000 }: Props) {
  const [scenes, setScenes] = useState<SceneMeta[] | null>(null);
  const [sceneId, setSceneId] = useState("");
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
    const before = await list();
    const known = new Set(before.ok ? before.data.puzzles.map((p) => p.id) : []);
    const res = await generate(sceneId);
    if (!res.ok) {
      setBusy(false);
      setError(res.error);
      return;
    }
    setDone("Building a puzzle from the approved pool…");
    onQueued?.();
    // The build runs in the background; watch the list for the new puzzle.
    for (let waited = 0; waited < waitMs; waited += pollMs) {
      await new Promise((r) => setTimeout(r, pollMs));
      const now = await list();
      if (now.ok && now.data.puzzles.some((p) => !known.has(p.id))) {
        setBusy(false);
        setDone("The new puzzle is built.");
        onQueued?.();
        return;
      }
    }
    setBusy(false);
    setDone("The build is queued but no new puzzle has shown up yet. Check the Jobs page; the approved pool may be too small.");
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
