"use client";

/**
 * /admin/scenes — CRUD for broadcast channels, both kinds in one list (plan
 * §8.1). Each channel is a named ControlState (a "scene" in the data model)
 * rendered full-bleed at its watch page (an OBS browser source / overlay
 * window): `/watch/:id` for weather, `/crossword/:id` for a crossword
 * (`outputPath` decides). Its console is `/control?scene=:id` for weather and
 * the crossword Desk for a crossword. Create seeds from the main channel (or a
 * chosen one) and picks the kind. The main channel is protected (no delete).
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
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import {
  MAIN_SCENE_ID,
  SCENE_SURFACES,
  sceneSurface,
  outputPath,
  type SceneMeta,
  type SceneSurface,
} from "@photonsurge/shared/control";
import { listScenes, createScene, deleteScene } from "../../../lib/scenes";
import { consoleHref, settingsHrefFor, surfaceLabel } from "../../../lib/channel-links";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { fetchYoutubeChannels, type YoutubeChannel } from "../../../components/admin/crosswords/channels/client";
import { font } from "../../../theme/tokens";

export default function ScenesPage() {
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [name, setName] = useState("");
  const [copyFrom, setCopyFrom] = useState<string>(MAIN_SCENE_ID);
  const [surface, setSurface] = useState<SceneSurface>("globe");
  const [filter, setFilter] = useState<SceneSurface | "all">("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [youtube, setYoutube] = useState<YoutubeChannel[]>([]);

  const refresh = useCallback(async () => {
    // The scene list carries each channel's YouTube account (`youtubeAccountId`).
    const [list, channels] = await Promise.all([listScenes(), fetchYoutubeChannels()]);
    setScenes(list);
    setYoutube(channels);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const add = async () => {
    setBusy(true);
    setError(null);
    const { error: err } = await createScene(name.trim(), copyFrom, surface);
    setBusy(false);
    if (err) {
      setError(err);
      return;
    }
    setName("");
    refresh();
  };

  const remove = async (id: string) => {
    if (!confirm(`Delete channel "${id}"? This cannot be undone.`)) return;
    const { error: err } = await deleteScene(id);
    if (err) setError(err);
    refresh();
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const shown = scenes.filter((s) => filter === "all" || sceneSurface(s) === filter);

  return (
    <AdminPageShell
      title="Channels"
      description={
        <>
          A weather channel renders at <code>/watch/&lt;id&gt;</code> and a crossword at{" "}
          <code>/crossword/&lt;id&gt;</code> (use that URL as an OBS browser source). Control
          opens a weather channel&apos;s console, Desk a crossword&apos;s live game. Tokened OBS URLs
          live in <MuiLink component={Link} href="/admin/access">Access</MuiLink>.
        </>
      }
      maxWidth={860}
    >
      {/* Create */}
      <Paper sx={{ p: 1.75, mt: 1.75 }}>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap", alignItems: "center" }}>
          <TextField
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="New channel name (e.g. Atlantic Wind)"
            onKeyDown={(e) => e.key === "Enter" && name.trim() && add()}
            slotProps={{ htmlInput: { "aria-label": "New channel name" } }}
            sx={{ flex: 1, minWidth: 200 }}
          />
          <TextField
            select
            label="type"
            value={surface}
            onChange={(e) => setSurface(e.target.value as SceneSurface)}
            sx={{ minWidth: 130 }}
          >
            {SCENE_SURFACES.map((k) => (
              <MenuItem key={k} value={k}>
                {surfaceLabel(k)}
              </MenuItem>
            ))}
          </TextField>
          {/* A crossword channel copies nothing: it starts from its own defaults. */}
          {surface === "globe" && (
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
          )}
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

      {/* Filter by kind */}
      <ToggleButtonGroup
        exclusive
        size="small"
        value={filter}
        onChange={(_, v) => v && setFilter(v)}
        aria-label="Channel type"
        sx={{ mt: 2.25 }}
      >
        <ToggleButton value="all">All</ToggleButton>
        {SCENE_SURFACES.map((k) => (
          <ToggleButton key={k} value={k}>
            {surfaceLabel(k)}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>

      {/* List */}
      <Box sx={{ display: "grid", gap: 1.25, mt: 1.5 }}>
        {shown.map((s) => {
          const kind = sceneSurface(s);
          const watch = outputPath(s);
          const control = consoleHref(s);
          const accountId = s.youtubeAccountId ?? "";
          const accountName = youtube.find((a) => a.id === accountId)?.title ?? accountId;
          const goesOutOn = accountName || (kind === "crossword" ? "none" : "default channel");
          return (
            <Paper key={s.id} sx={{ p: 1.75 }}>
              <Stack direction="row" spacing={1.75} sx={{ alignItems: "center" }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {s.name}
                    </Typography>
                    <Chip
                      label={surfaceLabel(kind)}
                      variant="outlined"
                      color={kind === "crossword" ? "secondary" : "default"}
                    />
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
                  <Typography variant="caption" color="text.secondary" component="div">
                    YouTube: <span data-testid={`youtube-${s.id}`}>{goesOutOn}</span>
                  </Typography>
                </Box>
                <MuiLink component={Link} href={settingsHrefFor(s)} variant="body2" sx={{ whiteSpace: "nowrap" }}>
                  Settings
                </MuiLink>
                <MuiLink component={Link} href={control} variant="body2" sx={{ whiteSpace: "nowrap" }}>
                  {kind === "crossword" ? "Desk" : "Control"}
                </MuiLink>
                <MuiLink component={Link} href={watch} target="_blank" variant="body2" sx={{ whiteSpace: "nowrap" }}>
                  Output ↗
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
