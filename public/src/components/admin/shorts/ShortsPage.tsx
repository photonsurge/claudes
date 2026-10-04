"use client";

/**
 * /admin/shorts — scripted short videos (docs/short-video-plan.md): generate a
 * round-up script in a format, list the saved scripts, inspect one's clips,
 * and preview it playing on its FORMAT's own scene (§5.3 — the scene a render
 * uses, so the preview is what renders), and the Formats section (list, new,
 * duplicate, delete; each format's editor is /admin/shorts/formats/:id), and
 * the Renders section (§6.7): Render on a script row or from the generate form
 * opens the Render form (§6.1); the section lists every queue and recent
 * render with its controls, and the Schedules section (§8): repeating batches,
 * Run batch now, each row linking its last batch in the Renders section. No
 * timeline editing yet.
 *
 * Renders update live from the socket run events (useStreams, the same
 * run:state / run:status the streams page uses) plus a poll of
 * /api/shorts/renders. While a render plays, the preview pane shows it: it
 * plays on its format's scene (§5.3).
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
import { playFor, sceneIdForScript, type ShortScript } from "@photonsurge/shared/short-script";
import AdminPageShell from "../AdminPageShell";
import ClipList from "./ClipList";
import FormatsSection from "./formats/FormatsSection";
import GenerateForm from "./GenerateForm";
import PreviewPane from "./PreviewPane";
import ScriptsTable from "./ScriptsTable";
import RenderDialog, { type RenderTarget } from "./RenderDialog";
import RendersSection from "./RendersSection";
import SchedulesSection from "./SchedulesSection";
import { renderIsActive } from "@photonsurge/shared/short-render";
import { controlRender, useRenders, type RenderAction } from "../../../lib/renders";
import { useStreams, useYoutubeVideoStats } from "../../../lib/stream";
import {
  deleteShort,
  getShort,
  playShortPreview,
  previewForFormat,
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
  const [renderTarget, setRenderTarget] = useState<RenderTarget | null>(null);
  // A schedule batch the Renders section is narrowed to (§8: the row links its last batch).
  const [batchId, setBatchId] = useState<string | null>(null);
  const showBatch = useCallback((id: string) => {
    setBatchId(id);
    document.getElementById("renders")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }, []);
  const { data: renders, error: rendersError, refresh: refreshRenders } = useRenders();
  const { snapshot, health } = useStreams();

  // Socket run events for render runs: fresher than the list, and a cue to re-read it.
  const renderRuns = useMemo(() => {
    const out: Record<string, NonNullable<typeof snapshot>["runs"][number]> = {};
    for (const r of snapshot?.runs ?? []) if (r.script) out[r.id] = r;
    return out;
  }, [snapshot]);
  const runsKey = Object.values(renderRuns)
    .map((r) => `${r.id}:${r.status}`)
    .join(",");
  useEffect(() => {
    if (runsKey) refreshRenders();
  }, [runsKey, refreshRenders]);
  const { stats: youtubeStats, error: statsError } = useYoutubeVideoStats(
    Object.values(renderRuns).some((r) => r.status === "live" && !!r.youtube?.broadcastId),
  );

  const onRenderAction = useCallback(
    async (a: RenderAction) => {
      const res = await controlRender(a);
      await refreshRenders();
      return res.ok ? { ok: true } : { ok: false, error: res.error };
    },
    [refreshRenders],
  );

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
  // The pane shows the selected script's format scene (the default's with none
  // selected) — or a render playing now: its format's first if several are.
  const activeRenders = (renders?.renders ?? []).filter((r) => renderIsActive(r.status) && r.formatId);
  const liveRender = activeRenders.find((r) => r.formatId === selectedRow?.formatId) ?? activeRenders[0];
  const pane = previewForFormat(data, liveRender?.formatId ?? selectedRow?.formatId);
  const liveRun = liveRender?.runId ? (renderRuns[liveRender.runId] ?? liveRender.run) : liveRender?.run;
  const rendering = liveRender
    ? {
        title: liveRun?.title || liveRender.label || "a video",
        detail: `${liveRender.offline ? "offline test" : liveRun?.status === "live" ? "live" : "starting"} on ${liveRender.assignedEncoderId ?? liveRender.encoderId}`,
      }
    : null;

  return (
    <AdminPageShell
      title="Short videos"
      description="Round-up videos built from the lineup template. Generate one for the globe, an area or a country in a format, then preview it on that format's own scene."
      maxWidth={1500}
      actions={
        <Button variant="outlined" onClick={() => refresh()}>
          Refresh
        </Button>
      }
    >
      <Stack spacing={1.75}>
        <GenerateForm
          onGenerated={onGenerated}
          onRender={(req) => setRenderTarget({ type: "generate", ...req })}
          formats={data?.formats ?? []}
        />

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
              formats={data.formats}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onPreview={preview}
              onRender={(id) => setRenderTarget({ type: "script", scriptId: id })}
              onDelete={(id) => act(() => deleteShort(id))}
              busy={busy}
            />

            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", lg: "minmax(360px, 1fr) minmax(480px, 1.4fr)" },
                gap: 1.75,
                alignItems: "start",
              }}
            >
              {shown ? (
                <ClipList script={shown} play={playFor(shown, sceneIdForScript(shown))} />
              ) : (
                <Typography color="text.secondary" sx={{ p: 1 }}>
                  {selectedId ? "Loading script…" : "Select a script to see its clips."}
                </Typography>
              )}
              <PreviewPane
                preview={pane}
                script={selectedRow}
                busy={busy}
                onPlay={() => selectedRow && preview(selectedRow.id)}
                onStop={() => act(() => stopShortPreview(pane.sceneId))}
                rendering={rendering}
              />
            </Box>
          </>
        )}

        <RendersSection
          data={renders}
          error={rendersError}
          runs={renderRuns}
          health={health}
          youtubeStats={youtubeStats}
          statsError={statsError}
          onAction={onRenderAction}
          batchId={batchId}
          onClearBatch={() => setBatchId(null)}
        />

        <SchedulesSection
          formats={data?.formats ?? []}
          scripts={scripts}
          onShowBatch={showBatch}
          onQueued={(r) => {
            refreshRenders();
            showBatch(r.batchId);
          }}
        />

        <FormatsSection onChanged={refresh} />
      </Stack>
      <RenderDialog
        open={!!renderTarget}
        target={renderTarget}
        onClose={() => setRenderTarget(null)}
        onQueued={() => refreshRenders()}
      />
    </AdminPageShell>
  );
}
