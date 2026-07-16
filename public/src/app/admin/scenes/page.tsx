"use client";

/**
 * /admin/scenes — CRUD for broadcast scenes. Each scene is a named ControlState
 * rendered full-bleed at `/watch/:id` (an OBS browser source / overlay window).
 * Create seeds from the main scene (or a chosen one); the operator then drives
 * it live from /control by selecting it in the scene picker. The main scene is
 * protected (no delete).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { MAIN_SCENE_ID, type SceneMeta } from "@photonsurge/shared/control";
import { listScenes, createScene, deleteScene } from "../../../lib/scenes";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { font } from "../../../theme/tokens";

export default function ScenesPage() {
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState<string>(MAIN_SCENE_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setScenes(await listScenes());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await createScene(name.trim(), copyFrom);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setName("");
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm(`Delete scene "${id}"? This cannot be undone.`)) return;
    const { error: err } = await deleteScene(id);
    if (err) setError(err);
    refresh();
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <AdminPageShell
      title="Scenes"
      description={
        <>
          Each scene renders at <code>/watch/&lt;id&gt;</code> — use that URL as an OBS browser
          source or overlay window. Drive a scene live from the{" "}
          <MuiLink component={Link} href="/control">operator console</MuiLink>.
          Tokened OBS URLs live in <MuiLink component={Link} href="/admin/access">Access</MuiLink>.
        </>
      }
      maxWidth={760}
    >
      {/* Create */}
      <Paper sx={{ p: 1.75, mt: 1.75 }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New scene name (e.g. Atlantic Wind)"
            onKeyDown={(e) => e.key === "Enter" && name.trim() && add()}
            slotProps={{ htmlInput: { "aria-label": "New scene name" } }}
            sx={{ flex: 1, minWidth: 200 }}
          />
          <TextField
            select
            label="copy from"
            // `scenes` loads async, so on first render the default `copyFrom`
            // names an option that doesn't exist yet and MUI warns about an
            // out-of-range value. Fall back to empty until its option is real.
            value={scenes.some((s) => s.id === copyFrom) ? copyFrom : ""}
            onChange={(e) => setCopyFrom(e.target.value)}
            sx={{ minWidth: 150 }}
          >
            {scenes.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
          {/* The page's one genuinely primary action, so the one filled button. */}
          <Button variant="contained" onClick={add} disabled={busy || !name.trim()}>
            {busy ? "…" : "Create"}
          </Button>
        </Stack>
      </Paper>
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}

      {/* List */}
      <Box sx={{ display: "grid", gap: 1.25, mt: 2.25 }}>
        {scenes.map((s) => {
          const watch = `/watch/${s.id}`;
          return (
            <Paper key={s.id} sx={{ p: 1.75 }}>
              <Stack direction="row" spacing={1.75} sx={{ alignItems: "center" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {s.name}
                    </Typography>
                    {s.id === MAIN_SCENE_ID && <Chip label="main" />}
                  </Stack>
                  {/* The URL is what gets pasted into OBS — a reading, in mono. */}
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                    sx={{ fontFamily: font.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {origin}
                    {watch}
                  </Typography>
                </Box>
                <MuiLink component={Link} href={watch} target="_blank" variant="body2" sx={{ whiteSpace: "nowrap" }}>
                  Open ↗
                </MuiLink>
                {s.id !== MAIN_SCENE_ID && (
                  <Button variant="outlined" color="error" onClick={() => remove(s.id)}>
                    Delete
                  </Button>
                )}
              </Stack>
            </Paper>
          );
        })}
      </Box>
    </AdminPageShell>
  );
}
