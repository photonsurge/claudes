"use client";

/**
 * /admin/shorts — scripted short videos (docs/short-video-plan.md), first cut:
 * generate a round-up script, list the saved scripts, inspect one's clips, and
 * preview it playing on the `shorts-preview` scene. No timeline editing,
 * render or scheduling yet — those join this page as their own sections.
 *
 * The list polls while a preview plays (see `useShortsList`), and the selected
 * script's detail reloads whenever its preview play record changes, so skipped
 * clips show their reasons as soon as the runner stamps them.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { playFor, type ShortScript } from "@photonsurge/shared/short-script";
import AdminPageShell from "../AdminPageShell";
import ClipList from "./ClipList";
import GenerateForm from "./GenerateForm";
import PreviewPane from "./PreviewPane";
import ScriptsTable from "./ScriptsTable";
import {
  deleteShort,
  getShort,
  playShortPreview,
  stopShortPreview,
  useShortsList,
  type GenerateShortResult,
} from "../../../lib/shorts";

export default function ShortsPage() {
  const { data, error: listError, refresh } = useShortsList();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ShortScript | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const scripts = useMemo(() => data?.scripts ?? [], [data]);
  const selectedRow = scripts.find((s) => s.id === selectedId) ?? null;

  // Default the selection to the newest script; drop it when it's gone.
  useEffect(() => {
    if (!data) return;
    if (!selectedId || !scripts.some((s) => s.id === selectedId)) setSelectedId(scripts[0]?.id ?? null);
  }, [data, scripts, selectedId]);

  // Reload the detail on a new selection or a changed preview play record.
  const playKey = selectedRow ? JSON.stringify(selectedRow.previewPlay ?? null) : "";
  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let live = true;
    getShort(selectedId).then((res) => {
      if (live) setDetail(res.ok ? res.data : null);
    });
    return () => {
      live = false;
    };
  }, [selectedId, playKey]);

  /** Run one action against the API, surface its error, then refresh the list. */
  const act = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusy(true);
      setActionError(null);
      const res = await fn();
      if (!res.ok) setActionError(res.error ?? "request failed");
      await refresh();
      setBusy(false);
    },
    [refresh],
  );

  const onGenerated = useCallback(
    (result: GenerateShortResult) => {
      setSelectedId(result.id);
      refresh();
    },
    [refresh],
  );

  const preview = (id: string) => {
    setSelectedId(id);
    act(() => playShortPreview(id));
  };

  const shown = detail && detail.id === selectedId ? detail : null;

  return (
    <AdminPageShell
      title="Short videos"
      description="Round-up videos built from the lineup template. Generate one for the globe, an area or a country, then preview it on the preview scene."
      maxWidth={1500}
      actions={
        <Button variant="outlined" onClick={() => refresh()}>
          Refresh
        </Button>
      }
    >
      <Stack spacing={1.75}>
        <GenerateForm onGenerated={onGenerated} />

        {listError && <Alert severity="error">Couldn&apos;t load scripts: {listError}</Alert>}
        {actionError && (
          <Alert severity="error" onClose={() => setActionError(null)}>
            {actionError}
          </Alert>
        )}

        {!data ? (
          <Typography color="text.secondary">{listError ? "" : "Loading…"}</Typography>
        ) : (
          <>
            <ScriptsTable
              scripts={scripts}
              preview={data.preview}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onPreview={preview}
              onDelete={(id) => act(() => deleteShort(id))}
              busy={busy}
            />

            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "minmax(360px, 1fr) minmax(480px, 1.4fr)" }, gap: 1.75, alignItems: "start" }}>
              {shown ? (
                <ClipList script={shown} play={playFor(shown, data.preview.sceneId)} />
              ) : (
                <Typography color="text.secondary" sx={{ p: 1 }}>
                  {selectedId ? "Loading script…" : "Select a script to see its clips."}
                </Typography>
              )}
              <PreviewPane
                preview={data.preview}
                script={selectedRow}
                busy={busy}
                onPlay={() => selectedRow && preview(selectedRow.id)}
                onStop={() => act(stopShortPreview)}
              />
            </Box>
          </>
        )}
      </Stack>
    </AdminPageShell>
  );
}
