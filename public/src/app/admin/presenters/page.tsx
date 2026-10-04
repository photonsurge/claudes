"use client";

/**
 * /admin/presenters — the presenter catalog and the voice bench
 * (docs/presenter-plan.md, voice audition). Every presenter has a Test button
 * that speaks the text box in its saved voice; the editor's "Test draft"
 * speaks unsaved settings. Takes stay listed for side-by-side comparison.
 *
 * The master switch at the top gates every speech call. Nothing here runs in
 * the background and nothing goes to air yet.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  DEFAULT_VOICE,
  TEST_TEXT_MAX,
  pricePerMillionChars,
  type Presenter,
  type PresenterVoice,
  type VoiceTest,
} from "@photonsurge/shared/presenter";
import AdminPageShell from "../../../components/admin/AdminPageShell";
import PresenterEditor from "../../../components/admin/presenters/PresenterEditor";
import TakeList from "../../../components/admin/presenters/TakeList";
import {
  deletePresenter,
  deleteTake,
  getPresenters,
  getTake,
  listTakes,
  refreshVoices,
  savePresenter,
  setPresenterEnabled,
  speakTake,
  voiceSummary,
  type PresentersResponse,
} from "../../../lib/presenters";
import { font } from "../../../theme/tokens";

const NEW_ID = "__new__";
const POLL_MS = 2000;
const DEFAULT_TEXT = "Good evening. Here is the latest from around the world.";

const blankPresenter = (): Presenter => ({ id: "", name: "", persona: "", voice: { ...DEFAULT_VOICE }, rev: 0 });

export default function PresentersPage() {
  const [data, setData] = useState<PresentersResponse | null>(null);
  const [takes, setTakes] = useState<VoiceTest[]>([]);
  const [text, setText] = useState(DEFAULT_TEXT);
  const [editing, setEditing] = useState<string | null>(null);
  /** Bumped to remount the editor with a new starting point (e.g. "Use this voice"). */
  const [editorSeed, setEditorSeed] = useState<{ key: number; presenter: Presenter } | null>(null);
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState<{ severity: "error" | "info" | "success"; text: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const mounted = useRef(true);

  const reload = useCallback(async () => {
    try {
      const [d, t] = await Promise.all([getPresenters(), listTakes()]);
      if (!mounted.current) return;
      setData(d);
      setTakes(t);
    } catch (e) {
      setMsg({ severity: "error", text: `Could not load presenters: ${String((e as Error).message ?? e)}` });
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    reload();
    return () => {
      mounted.current = false;
    };
  }, [reload]);

  const upsertTake = (t: VoiceTest) =>
    setTakes((list) => [t, ...list.filter((x) => x.id !== t.id)].sort((a, b) => b.createdAt.localeCompare(a.createdAt)));

  /** Speak, then poll until the take is finished (a slow model can outlast the request). */
  const runTest = async (key: string, input: { presenterId?: string | null; voice?: PresenterVoice; label?: string }) => {
    if (!text.trim()) return setMsg({ severity: "error", text: "Type something to say first." });
    setTesting((s) => new Set(s).add(key));
    setMsg(null);
    try {
      let take = await speakTake({ text, ...input });
      upsertTake(take);
      while (mounted.current && (take.status === "queued" || take.status === "speaking")) {
        await new Promise((r) => setTimeout(r, POLL_MS));
        const next = await getTake(take.id);
        if (!next) break;
        take = next;
        upsertTake(take);
      }
    } catch (e) {
      setMsg({ severity: "error", text: `Test failed: ${String((e as Error).message ?? e)}` });
    } finally {
      setTesting((s) => {
        const n = new Set(s);
        n.delete(key);
        return n;
      });
    }
  };

  const toggleEnabled = async (enabled: boolean) => {
    try {
      const settings = await setPresenterEnabled(enabled);
      setData((d) => (d ? { ...d, settings } : d));
    } catch (e) {
      setMsg({ severity: "error", text: String((e as Error).message ?? e) });
    }
  };

  const doRefreshVoices = async () => {
    setRefreshing(true);
    try {
      const r = await refreshVoices();
      setData((d) => (d ? { ...d, catalog: r.catalog } : d));
      setMsg(
        r.ok
          ? { severity: "success", text: `Loaded ${r.catalog.models.length} speech models.` }
          : { severity: "error", text: `Voice refresh failed: ${r.error}` },
      );
    } finally {
      setRefreshing(false);
    }
  };

  const openEditor = (id: string, presenter: Presenter) => {
    setEditing(id);
    setEditorSeed({ key: Date.now(), presenter });
  };

  const useVoice = (voice: PresenterVoice) => {
    if (!data) return;
    const current = editing && editing !== NEW_ID ? data.presenters.find((p) => p.id === editing) : null;
    const base = editorSeed?.presenter ?? current ?? blankPresenter();
    openEditor(editing ?? NEW_ID, { ...base, voice: { ...voice } });
    setMsg({ severity: "info", text: "Voice copied into the editor. Save to keep it." });
  };

  const enabled = !!data?.settings.enabled;
  const models = data?.catalog.models ?? [];

  return (
    <AdminPageShell
      title="Presenters"
      description="Presenter voices and the voice bench. Test a presenter to hear the text below in its voice."
      actions={
        <>
          <Button variant="outlined" onClick={doRefreshVoices} disabled={refreshing}>
            {refreshing ? "Refreshing…" : "Refresh voices"}
          </Button>
          <Button variant="contained" onClick={() => openEditor(NEW_ID, blankPresenter())}>
            New presenter
          </Button>
        </>
      }
    >
      <Paper sx={{ p: 1.75, mb: 2 }}>
        <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
          <Switch
            checked={enabled}
            disabled={!data}
            onChange={(_, v) => toggleEnabled(v)}
            slotProps={{ input: { "aria-label": "Presenter on" } }}
          />
          <Stack sx={{ flex: 1 }}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              Presenter {enabled ? "on" : "off"}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {enabled
                ? "Speech calls are allowed. Each test is billed by OpenRouter."
                : "No speech is made anywhere, tests included. Turn on to audition voices."}
            </Typography>
          </Stack>
          <Typography variant="caption" color="text.disabled" sx={{ fontFamily: font.mono }}>
            {data?.catalog.fetchedAt
              ? `${models.length} models · fetched ${new Date(data.catalog.fetchedAt).toLocaleString()}`
              : "voice list not fetched"}
          </Typography>
        </Stack>
      </Paper>

      {msg && (
        <Alert severity={msg.severity} sx={{ mb: 2 }} onClose={() => setMsg(null)}>
          {msg.text}
        </Alert>
      )}

      <Paper sx={{ p: 1.75, mb: 2 }}>
        <Typography variant="overline" color="text.secondary">
          What to say
        </Typography>
        <TextField
          fullWidth
          multiline
          minRows={3}
          maxRows={12}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, TEST_TEXT_MAX))}
          helperText={`${text.length} characters. Units, magnitudes and symbols are rewritten for the ear before sending.`}
          sx={{ mt: 0.5 }}
        />
        {!!data?.samples.length && (
          <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: "wrap", mt: 1 }}>
            {data.samples.map((s) => (
              <Chip key={s.label} size="small" variant="outlined" label={s.label} onClick={() => setText(s.text.slice(0, TEST_TEXT_MAX))} />
            ))}
          </Stack>
        )}
      </Paper>

      <Typography variant="overline" color="text.secondary">
        Presenters
      </Typography>
      <Stack spacing={1.25} sx={{ mb: 3 }}>
        {editing === NEW_ID && editorSeed && (
          <Paper sx={{ p: 1.75 }}>
            <Typography variant="body1" sx={{ fontWeight: 600 }}>
              New presenter
            </Typography>
            <PresenterEditor
              key={editorSeed.key}
              initial={editorSeed.presenter}
              models={models}
              isNew
              disabled={!enabled || testing.has(NEW_ID)}
              onCancel={() => setEditing(null)}
              onTestDraft={(p) => runTest(NEW_ID, { voice: p.voice, label: `${p.name || "New presenter"} (draft)` })}
              onSave={async (p) => {
                await savePresenter(p);
                setEditing(null);
                await reload();
              }}
            />
          </Paper>
        )}

        {data?.presenters.map((p) => {
          const price = pricePerMillionChars(models.find((m) => m.id === p.voice.model)?.pricing);
          return (
            <Paper key={p.id} sx={{ p: 1.75 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }} useFlexGap>
                <Stack sx={{ flex: 1, minWidth: 200 }}>
                  <Typography variant="body1" sx={{ fontWeight: 600 }}>
                    {p.name}
                    {p.rev === 0 && (
                      <Typography component="span" variant="caption" color="text.disabled" sx={{ ml: 1 }}>
                        default, not saved yet
                      </Typography>
                    )}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ fontFamily: font.mono }}>
                    {voiceSummary(p.voice)}
                    {p.voice.style ? ` · “${p.voice.style}”` : ""}
                    {price != null ? ` · $${price}/M chars` : ""}
                  </Typography>
                </Stack>
                <Button
                  variant="contained"
                  disabled={!enabled || testing.has(p.id)}
                  onClick={() => runTest(p.id, { presenterId: p.id, voice: p.voice, label: p.name })}
                >
                  {testing.has(p.id) ? "Speaking…" : `Test ${p.name}`}
                </Button>
                <Button variant="outlined" onClick={() => (editing === p.id ? setEditing(null) : openEditor(p.id, p))}>
                  {editing === p.id ? "Close" : "Edit"}
                </Button>
              </Stack>
              {editing === p.id && editorSeed && (
                <PresenterEditor
                  key={editorSeed.key}
                  initial={editorSeed.presenter}
                  models={models}
                  isNew={false}
                  disabled={!enabled || testing.has(p.id)}
                  onCancel={() => setEditing(null)}
                  onTestDraft={(d) => runTest(p.id, { presenterId: p.id, voice: d.voice, label: `${d.name} (draft)` })}
                  onSave={async (d) => {
                    await savePresenter({ ...d, id: p.id });
                    setEditing(null);
                    await reload();
                  }}
                  onDelete={async () => {
                    await deletePresenter(p.id);
                    setEditing(null);
                    await reload();
                  }}
                />
              )}
            </Paper>
          );
        })}
      </Stack>

      <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="overline" color="text.secondary">
          Takes
        </Typography>
        <Button size="small" onClick={reload}>
          Refresh
        </Button>
      </Stack>
      <TakeList
        takes={takes}
        onUseVoice={useVoice}
        onDelete={async (id) => {
          await deleteTake(id);
          setTakes((list) => list.filter((t) => t.id !== id));
        }}
      />
    </AdminPageShell>
  );
}
