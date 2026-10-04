"use client";

/**
 * /admin/shorts/formats/:id — a short format's editor (docs/short-video-plan.md
 * §5.5). The channel settings page's machinery over the format's own documents:
 * `SceneDraftProvider` owns the format's scene look, its director config AND
 * its short settings, and the page saves all three with ONE Save. Its own card
 * list (format-catalog.ts) groups the shared card components with the cards
 * only a short has.
 *
 * Beside the cards, the format's /watch page (the /admin/shorts preview pane)
 * with Play sample: it plays the format's most recent script, or generates one
 * from the format's template first. The preview shows SAVED settings; staged
 * edits reach it on Save.
 */
import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import MuiLink from "@mui/material/Link";
import Stack from "@mui/material/Stack";
import type { ShortScript } from "@photonsurge/shared/short-script";
import AdminPageShell from "../../AdminPageShell";
import SceneDraftProvider, { useSceneDraft } from "../../scenes/SceneDraft";
import SettingsBody from "../../scenes/SettingsBody";
import { SettingsCatalogContext } from "../../scenes/catalog-context";
import AboutCardSettings from "../../scenes/AboutCardSettings";
import AudioSettings from "../../scenes/AudioSettings";
import CameraSettings from "../../scenes/CameraSettings";
import ChannelSettings from "../../scenes/ChannelSettings";
import PaceSettings from "../../scenes/PaceSettings";
import ReportSettings from "../../scenes/ReportSettings";
import SlidesSettings from "../../scenes/SlidesSettings";
import ThemeSettings from "../../scenes/ThemeSettings";
import TickerSettings from "../../scenes/TickerSettings";
import PreviewPane from "../PreviewPane";
import CopyLookDialog from "./CopyLookDialog";
import FormatLooksSettings from "./FormatLooksSettings";
import FormatOpenerSettings from "./FormatOpenerSettings";
import FormatRenderSettings from "./FormatRenderSettings";
import FormatTemplateSettings from "./FormatTemplateSettings";
import FormatTimingSettings from "./FormatTimingSettings";
import FormatVideoSettings from "./FormatVideoSettings";
import { DEFAULT_FORMAT_GROUP, FORMAT_CATALOG } from "./format-catalog";
import { FormatScriptContext } from "./format-script";
import {
  generateShort,
  getShort,
  playShortPreview,
  previewForFormat,
  stopShortPreview,
  useShortsList,
} from "../../../../lib/shorts";

/** Card id → component; the catalog holds the rest. */
const CARD_COMPONENTS: Record<string, ComponentType> = {
  template: FormatTemplateSettings,
  opener: FormatOpenerSettings,
  "youtube-video": FormatVideoSettings,
  timing: FormatTimingSettings,
  render: FormatRenderSettings,
  widgets: ChannelSettings,
  report: ReportSettings,
  deck: SlidesSettings,
  crawl: TickerSettings,
  theme: ThemeSettings,
  camera: CameraSettings,
  audio: AudioSettings,
  pace: PaceSettings,
  looks: FormatLooksSettings,
  about: AboutCardSettings,
};

export default function FormatEditor({ formatId }: { formatId: string }) {
  // Bumped after "Copy look from…": remounts the draft (a fresh read of the
  // copied look) and the preview frame (the copy isn't pushed to it live).
  const [epoch, setEpoch] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const reload = useCallback((message: string) => {
    setNotice(message);
    setEpoch((e) => e + 1);
  }, []);

  return (
    <SettingsCatalogContext.Provider value={FORMAT_CATALOG}>
      <SceneDraftProvider key={epoch} sceneId={formatId} formatId={formatId}>
        <EditorShell formatId={formatId} epoch={epoch} notice={notice} onNotice={setNotice} onReload={reload} />
      </SceneDraftProvider>
    </SettingsCatalogContext.Provider>
  );
}

function EditorShell({
  formatId,
  epoch,
  notice,
  onNotice,
  onReload,
}: {
  formatId: string;
  epoch: number;
  notice: string | null;
  onNotice: (m: string | null) => void;
  onReload: (message: string) => void;
}) {
  const { format, dirty } = useSceneDraft();
  const { data, refresh } = useShortsList();
  const [copyOpen, setCopyOpen] = useState(false);
  const [busy, setBusy] = useState<null | "generating" | "request">(null);
  const [error, setError] = useState<string | null>(null);

  // The list is newest first, so the first of this format's is its most recent.
  const latestRow = useMemo(() => data?.scripts.find((s) => s.formatId === formatId) ?? null, [data, formatId]);
  const latestId = latestRow?.id;
  const [latest, setLatest] = useState<ShortScript | null>(null);
  useEffect(() => {
    if (!latestId) {
      setLatest(null);
      return;
    }
    let live = true;
    getShort(latestId).then((res) => live && setLatest(res.ok ? res.data : null));
    return () => {
      live = false;
    };
  }, [latestId]);

  const preview = previewForFormat(data, formatId);
  const name = format?.name || formatId;

  /** Play sample: the most recent script, or generate one from the saved template first. */
  const playSample = async () => {
    setError(null);
    let scriptId = latestRow?.id;
    if (!scriptId) {
      setBusy("generating");
      // The format's saved template scope; a format with none samples the globe.
      const gen = await generateShort(format?.template.scope ? { formatId } : { formatId, scope: { type: "globe" } });
      if (!gen.ok) {
        setBusy(null);
        setError(gen.error);
        return;
      }
      scriptId = gen.data.id;
    }
    setBusy("request");
    const res = await playShortPreview(scriptId);
    if (!res.ok) setError(res.error);
    await refresh();
    setBusy(null);
  };

  const stop = async () => {
    setBusy("request");
    const res = await stopShortPreview(formatId);
    if (!res.ok) setError(res.error);
    await refresh();
    setBusy(null);
  };

  const pane = (
    <Stack spacing={1}>
      <PreviewPane
        key={epoch}
        preview={preview}
        script={latestRow}
        busy={!!busy}
        playLabel={busy === "generating" ? "Generating…" : "Play sample"}
        canPlay={!latestRow || latestRow.clipCount > 0}
        onPlay={playSample}
        onStop={stop}
        note={
          latestRow
            ? `Play sample runs “${latestRow.title}”, this format's most recent script. It shows saved settings — staged edits appear after Save.`
            : "No script in this format yet: Play sample generates one from the saved template, then plays it. It shows saved settings — staged edits appear after Save."
        }
      />
      {error && (
        <Alert severity="error" onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
    </Stack>
  );

  return (
    <AdminPageShell
      title={`Format: ${name}`}
      crumbs={[{ href: "/admin/shorts", label: "Short videos" }, { label: name }]}
      description="Everything a video of this format looks like and is told. Changes stay staged until you press Save, then apply to this format's scene and to its next video."
      maxWidth={1640}
      actions={
        <>
          <Button variant="outlined" size="small" onClick={() => setCopyOpen(true)}>
            Copy look from…
          </Button>
          <MuiLink component={Link} href={`/admin/shorts`} variant="body2" sx={{ whiteSpace: "nowrap" }}>
            All formats
          </MuiLink>
        </>
      }
    >
      {notice && (
        <Alert severity="success" onClose={() => onNotice(null)} sx={{ mb: 2 }}>
          {notice}
        </Alert>
      )}
      <FormatScriptContext.Provider value={latest}>
        <SettingsBody components={CARD_COMPONENTS} defaultGroup={DEFAULT_FORMAT_GROUP} aside={pane} loadingLabel="Loading format" />
      </FormatScriptContext.Provider>
      <CopyLookDialog
        formatId={formatId}
        open={copyOpen}
        dirty={dirty}
        onClose={() => setCopyOpen(false)}
        onCopied={(from) => {
          setCopyOpen(false);
          onReload(`Copied the look from “${from}”.`);
        }}
      />
    </AdminPageShell>
  );
}
