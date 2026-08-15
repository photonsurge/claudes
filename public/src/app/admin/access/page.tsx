"use client";

/**
 * /admin/access — tokened OBS/YouTube URLs, one per broadcast scene.
 * `/watch/:id` can't do interactive login (it's loaded by OBS/YouTube), so
 * each scene carries a secret `watchToken`; the URL here is the only place
 * that secret is exposed. Kept separate from /admin/scenes (which manages
 * scene *content*, not access) so rotating a token is a deliberate, isolated
 * action.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import MuiLink from "@mui/material/Link";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { MAIN_SCENE_ID, type SceneMeta } from "@photonsurge/shared/control";
import { listScenes, rotateSceneToken } from "../../../lib/scenes";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import { font } from "../../../theme/tokens";

export default function AccessPage() {
  const [scenes, setScenes] = useState<SceneMeta[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [rotatingId, setRotatingId] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setScenes(await listScenes());
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const rotate = async (id: string) => {
    if (!confirm("Rotate this scene's watch token? Any previously-copied /watch URL will stop working.")) return;
    setRotatingId(id);
    const { error: err } = await rotateSceneToken(id);
    setRotatingId(null);
    if (err) setError(err);
    refresh();
  };

  const copy = (id: string, url: string) => {
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedId(id);
    setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1500);
  };

  const origin = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <AdminPageShell
      title="Access"
      description={
        <>
          Tokened OBS/YouTube URLs for each scene. Paste the copied URL into your OBS browser
          source instead of the bare <code>/watch/&lt;id&gt;</code> address — anyone with the
          token can view the output, so rotate it if a URL ever leaks. Manage scene content in{" "}
          <MuiLink component={Link} href="/admin/scenes">Channels</MuiLink>.
        </>
      }
      maxWidth={760}
    >
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}

      <Box sx={{ display: "grid", gap: 1.25, mt: 2.25 }}>
        {scenes.map((s) => {
          const watch = `/watch/${s.id}`;
          const tokenedUrl = s.watchToken ? `${origin}${watch}?token=${s.watchToken}` : null;
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
                  {/* The tokened URL is what gets pasted into OBS — mono, so a
                      token can actually be read character by character. */}
                  <Typography
                    variant="caption"
                    color="text.secondary"
                    component="div"
                    sx={{ fontFamily: font.mono, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                  >
                    {tokenedUrl ?? "no token yet — generate one"}
                  </Typography>
                </Box>
                {tokenedUrl && (
                  <Button variant="outlined" onClick={() => copy(s.id, tokenedUrl)}>
                    {copiedId === s.id ? "Copied" : "Copy"}
                  </Button>
                )}
                <Button variant="outlined" onClick={() => rotate(s.id)} disabled={rotatingId === s.id} sx={{ whiteSpace: "nowrap" }}>
                  {rotatingId === s.id ? "…" : s.watchToken ? "Rotate token" : "Generate token"}
                </Button>
              </Stack>
            </Paper>
          );
        })}
      </Box>
    </AdminPageShell>
  );
}
