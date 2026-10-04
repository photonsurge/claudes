"use client";

/**
 * RoundupScheduleCard — the operator's "which round-ups run, and when" control,
 * mounted on both round-up pages with a different subset of ids. Per row: an
 * on/off switch plus a 24-hour strip. The card edits a DRAFT; Save sends only
 * this card's ids (the route overlays them on what is stored, so the other
 * page's rows are untouched) and adopts the stored result.
 *
 * Global rows are UTC slots and show next/last run; place rows are LOCAL hours
 * at each place, so they show the picked hours as local times instead.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import Typography from "@mui/material/Typography";
import {
  ROUNDUP_META,
  normalizeHours,
  type RoundupId,
  type RoundupSetting,
  type RoundupSettings,
} from "@photonsurge/shared/roundup-settings";
import { nextSlotStart } from "@photonsurge/shared/roundup-schedule";
import { getRoundupSettings, saveRoundupSettings, type RoundupSettingsResponse } from "../../../lib/roundupSettings";
import { font } from "../../../theme/tokens";
import HourStrip, { pad2 } from "./HourStrip";

const ALL_HOURS = Array.from({ length: 24 }, (_, h) => h);

const fmtUtc = (d: Date): string => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
const fmtLast = (iso?: string | null): string => {
  const d = iso ? new Date(iso) : null;
  return d && !Number.isNaN(d.getTime()) ? fmtUtc(d) : "never";
};

/** "06:00", "06:00 and 18:00", "06:00, 12:00 and 18:00". */
const joinHours = (hours: number[]): string => {
  const t = hours.map((h) => `${pad2(h)}:00`);
  return t.length < 2 ? t.join("") : `${t.slice(0, -1).join(", ")} and ${t[t.length - 1]}`;
};

const sameSetting = (a: RoundupSetting, b: RoundupSetting) =>
  a.enabled === b.enabled && a.hours.length === b.hours.length && a.hours.every((h, i) => h === b.hours[i]);

function caption(id: RoundupId, s: RoundupSetting, now: Date, lastRun?: string | null): string {
  if (!s.enabled || !s.hours.length) {
    return "Not generated on a schedule — “Generate now” still works.";
  }
  if (ROUNDUP_META[id].clock === "local") return `${joinHours(s.hours)} local`;
  const next = nextSlotStart(now, s.hours);
  return `Next ${next ? fmtUtc(next) : "—"} · last ${fmtLast(lastRun)}`;
}

export default function RoundupScheduleCard({ ids, now }: { ids: RoundupId[]; now?: Date }) {
  const [loaded, setLoaded] = useState<RoundupSettings | null>(null);
  const [draft, setDraft] = useState<RoundupSettings | null>(null);
  const [lastRun, setLastRun] = useState<RoundupSettingsResponse["lastRun"]>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getRoundupSettings()
      .then((r) => {
        if (cancelled) return;
        setLoaded(r.settings);
        setDraft(r.settings);
        setLastRun(r.lastRun);
      })
      .catch((e) => !cancelled && setError(`Could not load the schedule: ${String(e?.message ?? e)}`));
    return () => {
      cancelled = true;
    };
  }, []);

  const edit = useCallback(
    (id: RoundupId, fn: (s: RoundupSetting) => RoundupSetting) =>
      setDraft((d) => (d ? { ...d, [id]: fn(d[id]) } : d)),
    [],
  );

  const dirty = useMemo(
    () => !!loaded && !!draft && ids.some((id) => !sameSetting(loaded[id], draft[id])),
    [ids, loaded, draft],
  );

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const body: Partial<RoundupSettings> = {};
      for (const id of ids) body[id] = draft[id];
      const stored = await saveRoundupSettings(body);
      setLoaded(stored);
      setDraft(stored);
    } catch (e) {
      setError(`Save failed: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setSaving(false);
    }
  };

  const at = now ?? new Date();

  return (
    <Paper sx={{ p: 1.75, mb: 2 }}>
      <Stack direction="row" spacing={1} sx={{ justifyContent: "space-between", alignItems: "center" }}>
        <Typography variant="overline" color="text.secondary">
          Schedule
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button size="small" variant="outlined" disabled={!dirty || saving} onClick={() => setDraft(loaded)}>
            Revert
          </Button>
          <Button size="small" variant="contained" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </Stack>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}

      {draft ? (
        ids.map((id) => {
          const meta = ROUNDUP_META[id];
          const s = draft[id];
          return (
            <Stack key={id} spacing={0.75} sx={{ py: 1.25, borderTop: "1px solid", borderColor: "divider", mt: 1 }}>
              <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                <Switch
                  size="small"
                  checked={s.enabled}
                  onChange={(_, enabled) => edit(id, (x) => ({ ...x, enabled }))}
                  slotProps={{ input: { "aria-label": `${meta.label} enabled` } }}
                />
                <Typography variant="body2" sx={{ fontWeight: 600, flex: 1 }}>
                  {meta.label}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {meta.clock === "utc" ? "UTC" : "local time at each place"}
                </Typography>
                <Button size="small" onClick={() => edit(id, (x) => ({ ...x, hours: ALL_HOURS }))}>
                  Every hour
                </Button>
                <Button size="small" onClick={() => edit(id, (x) => ({ ...x, hours: [] }))}>
                  Clear
                </Button>
              </Stack>
              <HourStrip
                label={meta.label}
                hours={s.hours}
                dimmed={!s.enabled}
                onToggle={(h) =>
                  edit(id, (x) => ({
                    ...x,
                    hours: normalizeHours(x.hours.includes(h) ? x.hours.filter((v) => v !== h) : [...x.hours, h]),
                  }))
                }
              />
              <Typography variant="caption" color="text.secondary" sx={{ fontFamily: font.mono }}>
                {caption(id, s, at, lastRun[id])}
              </Typography>
            </Stack>
          );
        })
      ) : (
        !error && (
          <Typography variant="body2" color="text.disabled" sx={{ mt: 1 }}>
            Loading…
          </Typography>
        )
      )}

      <Typography variant="caption" color="text.disabled" sx={{ display: "block", mt: 0.5 }}>
        Changes apply at the next hourly check — no restart needed. A run made with “Generate now” inside a slot counts
        as that slot&apos;s run.
      </Typography>
    </Paper>
  );
}
