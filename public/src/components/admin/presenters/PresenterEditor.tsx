"use client";

/**
 * PresenterEditor — one presenter's name, persona and every voice property,
 * edited as a draft. "Test draft" speaks the unsaved settings so a change can
 * be heard before Save (docs/presenter-plan.md §5.1).
 */
import { useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Slider from "@mui/material/Slider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import {
  SPEED_MAX,
  SPEED_MIN,
  pricePerMillionChars,
  type Presenter,
  type PresenterVoice,
  type SpeechModel,
} from "@photonsurge/shared/presenter";

/** Mirrors the worker's voice-traits table, so the editor can say whether the style reaches the model. */
export function styleNote(model: string): string {
  if (model.startsWith("google/gemini") && model.includes("tts")) return "Sent as a spoken direction before the text.";
  if (model.startsWith("fish-audio/")) return "Sent as a (tag) before the text.";
  if (model.startsWith("mistralai/voxtral") || model.startsWith("sesame/csm"))
    return "This model takes its manner from the voice id — pick a voice instead (e.g. …_neutral, …_sad).";
  return "Not sent to this model yet — test it and tell us if a provider option works (see Options).";
}

export interface PresenterEditorProps {
  initial: Presenter;
  models: SpeechModel[];
  isNew: boolean;
  disabled?: boolean;
  onSave: (p: Presenter) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
  onTestDraft: (p: Presenter) => void;
}

export default function PresenterEditor({ initial, models, isNew, disabled, onSave, onDelete, onCancel, onTestDraft }: PresenterEditorProps) {
  const [draft, setDraft] = useState<Presenter>(initial);
  const [optionsText, setOptionsText] = useState(initial.voice.options ? JSON.stringify(initial.voice.options, null, 2) : "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const model = models.find((m) => m.id === draft.voice.model);
  const price = pricePerMillionChars(model?.pricing);
  const modelIds = useMemo(() => models.map((m) => m.id), [models]);

  const setVoice = (patch: Partial<PresenterVoice>) => setDraft((d) => ({ ...d, voice: { ...d.voice, ...patch } }));
  // Voices belong to a model, so a different model clears the voice. Only a real
  // change does: Autocomplete also reports the initial value on mount.
  const setModel = (raw: string) =>
    setDraft((d) => {
      const m = raw.trim();
      return m === d.voice.model ? d : { ...d, voice: { ...d.voice, model: m, voice: null } };
    });

  /** The draft with the options JSON parsed in, or null (and an error shown) when the JSON is bad. */
  const withOptions = (): Presenter | null => {
    const t = optionsText.trim();
    if (!t) return { ...draft, voice: { ...draft.voice, options: null } };
    try {
      const parsed = JSON.parse(t);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("must be a JSON object");
      return { ...draft, voice: { ...draft.voice, options: parsed } };
    } catch (e) {
      setError(`Options: ${(e as Error).message}`);
      return null;
    }
  };

  const save = async () => {
    setError(null);
    const p = withOptions();
    if (!p) return;
    if (!p.name.trim()) return setError("Give the presenter a name.");
    setSaving(true);
    try {
      await onSave(p);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
      {error && <Alert severity="error">{error}</Alert>}
      <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
        <TextField
          label="Name"
          size="small"
          value={draft.name}
          onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
          sx={{ flex: 1 }}
        />
        <TextField label="Id" size="small" value={isNew ? "(from the name)" : draft.id} disabled sx={{ width: 180 }} />
      </Stack>

      <Autocomplete
        freeSolo
        size="small"
        options={modelIds}
        value={draft.voice.model}
        onChange={(_, v) => setModel(v ?? "")}
        onInputChange={(_, v, reason) => reason === "input" && setModel(v)}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Speech model"
            helperText={
              models.length
                ? `${model?.voices.length ?? 0} voices · ${price != null ? `$${price} per million characters` : "price per second or unknown"}`
                : "No model list yet — press “Refresh voices”. You can still type a model id."
            }
          />
        )}
      />

      <Autocomplete
        freeSolo
        size="small"
        options={model?.voices ?? []}
        value={draft.voice.voice ?? ""}
        onChange={(_, v) => setVoice({ voice: v?.trim() || null })}
        onInputChange={(_, v, reason) => reason === "input" && setVoice({ voice: v.trim() || null })}
        renderInput={(params) => (
          <TextField {...params} label="Voice" helperText="Empty = the model's default voice. You can type a provider voice id." />
        )}
      />

      <Stack>
        <Typography variant="caption" color="text.secondary">
          Speed {draft.voice.speed.toFixed(2)}×
        </Typography>
        <Slider
          size="small"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={0.05}
          value={draft.voice.speed}
          onChange={(_, v) => setVoice({ speed: v as number })}
          marks={[{ value: 1, label: "1×" }]}
          slotProps={{ input: { "aria-label": "Speed" } }}
        />
      </Stack>

      <TextField
        label="Style"
        size="small"
        value={draft.voice.style ?? ""}
        onChange={(e) => setVoice({ style: e.target.value || null })}
        placeholder="calm, measured, late-night desk"
        helperText={styleNote(draft.voice.model)}
      />

      <TextField
        label="Options (provider JSON, advanced)"
        size="small"
        multiline
        minRows={2}
        value={optionsText}
        onChange={(e) => setOptionsText(e.target.value)}
        placeholder='{ "provider": { "order": ["…"] } }'
        helperText="Merged into the speech request as given."
        slotProps={{ input: { sx: { fontFamily: "monospace", fontSize: 13 } } }}
      />

      <TextField
        label="Persona"
        size="small"
        multiline
        minRows={2}
        value={draft.persona}
        onChange={(e) => setDraft((d) => ({ ...d, persona: e.target.value }))}
        helperText="Who they are and how they talk. Used once presenters write their own lines; not part of a voice test."
      />

      <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Button
          variant="outlined"
          disabled={disabled}
          onClick={() => {
            setError(null);
            const p = withOptions();
            if (p) onTestDraft(p);
          }}
        >
          Test draft
        </Button>
        <Button variant="contained" onClick={save} disabled={saving}>
          {saving ? "Saving…" : isNew ? "Create" : "Save"}
        </Button>
        <Button onClick={onCancel}>Cancel</Button>
        {onDelete && !isNew && (
          <Button
            color="error"
            sx={{ ml: "auto" }}
            onClick={async () => {
              if (window.confirm(`Delete ${draft.name}?`)) await onDelete();
            }}
          >
            Delete
          </Button>
        )}
      </Stack>
    </Stack>
  );
}
