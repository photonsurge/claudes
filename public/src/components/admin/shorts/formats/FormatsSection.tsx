"use client";

/**
 * The Formats section on /admin/shorts (docs/short-video-plan.md §5.5): every
 * format with how many scripts are made in it, a link to its editor, Duplicate
 * and Delete, and New format — a name and what to duplicate it from (any
 * channel or format). From a channel the short settings start at defaults;
 * from a format they are copied too.
 *
 * Delete asks first, and shows the API's refusal as it comes — it refuses a
 * format scripts still use, saying how many. The default format can't be
 * deleted, so its Delete is disabled.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import { MAIN_SCENE_ID, type SceneMeta } from "@photonsurge/shared/control";
import { DEFAULT_SHORT_FORMAT_ID } from "@photonsurge/shared/short-scenes";
import {
  createShortFormat,
  deleteShortFormat,
  loadFormatSources,
} from "../../../../lib/short-formats";
import { formatDuration, scopeLabel, type ShortFormatItem } from "../../../../lib/shorts";
import { font } from "../../../../theme/tokens";
import FormatSourceSelect from "./FormatSourceSelect";

const editorHref = (id: string) => `/admin/shorts/formats/${encodeURIComponent(id)}`;

interface Props {
  /** A format was made or deleted — the page refreshes its own lists. */
  onChanged?: () => void;
  /** Injectable for tests. */
  load?: typeof loadFormatSources;
  create?: typeof createShortFormat;
  remove?: typeof deleteShortFormat;
  confirm?: (message: string) => boolean;
  prompt?: (message: string, fallback: string) => string | null;
}

export default function FormatsSection({
  onChanged,
  load = loadFormatSources,
  create = createShortFormat,
  remove = deleteShortFormat,
  confirm = (m) => window.confirm(m),
  prompt = (m, d) => window.prompt(m, d),
}: Props) {
  const [channels, setChannels] = useState<SceneMeta[]>([]);
  const [formats, setFormats] = useState<ShortFormatItem[] | null>(null);
  const [name, setName] = useState("");
  const [from, setFrom] = useState<string>(MAIN_SCENE_ID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ id: string; name: string } | null>(null);

  const refresh = useCallback(async () => {
    const res = await load();
    setChannels(res.channels);
    setFormats(res.formats);
  }, [load]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const duplicate = async (newName: string, source: string) => {
    setBusy(true);
    setError(null);
    setMade(null);
    const res = await create(newName.trim(), source);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return false;
    }
    setMade({ id: res.data.format.id, name: res.data.format.name });
    await refresh();
    onChanged?.();
    return true;
  };

  const makeNew = async () => {
    if (await duplicate(name, from)) setName("");
  };

  const duplicateRow = (f: ShortFormatItem) => {
    const newName = prompt(`Name for the copy of “${f.name}”:`, `${f.name} copy`);
    if (newName && newName.trim()) duplicate(newName, f.id);
  };

  const deleteRow = async (f: ShortFormatItem) => {
    if (!confirm(`Delete the format “${f.name}”, with its look and settings? This can't be undone.`)) return;
    setBusy(true);
    setError(null);
    setMade(null);
    const res = await remove(f.id);
    setBusy(false);
    if (!res.ok) setError(`Couldn't delete “${f.name}”: ${res.error}`);
    await refresh();
    onChanged?.();
  };

  return (
    <Paper sx={{ p: 1.75 }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        Formats{formats ? ` (${formats.length})` : ""}
      </Typography>
      <Typography variant="caption" color="text.secondary" component="p">
        A format is a kind of video with its own look and settings. Each is a copy, not a link: a channel&apos;s later
        changes reach a format only through its Copy look from….
      </Typography>

      <Table size="small" sx={{ mt: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>Name</TableCell>
            <TableCell>Scope</TableCell>
            <TableCell sx={numHead}>Budget</TableCell>
            <TableCell sx={numHead}>Scripts</TableCell>
            <TableCell />
          </TableRow>
        </TableHead>
        <TableBody>
          {(formats ?? []).map((f) => {
            const isDefault = f.id === DEFAULT_SHORT_FORMAT_ID;
            return (
              <TableRow key={f.id} hover>
                <TableCell sx={{ fontWeight: 600 }}>
                  <Stack direction="row" spacing={1} sx={{ alignItems: "center" }}>
                    <Link href={editorHref(f.id)} style={{ color: "inherit" }}>
                      {f.name}
                    </Link>
                    {isDefault && <Chip size="small" variant="outlined" label="default" />}
                  </Stack>
                </TableCell>
                <TableCell>{f.template.scope ? scopeLabel(f.template.scope) : "Asked at Generate"}</TableCell>
                <TableCell sx={numCell}>{formatDuration(f.template.budgetMs)}</TableCell>
                <TableCell sx={numCell}>{f.scriptCount}</TableCell>
                <TableCell align="right" sx={{ whiteSpace: "nowrap" }}>
                  <Button size="small" component={Link} href={editorHref(f.id)}>
                    Edit
                  </Button>
                  <Button size="small" disabled={busy} onClick={() => duplicateRow(f)}>
                    Duplicate
                  </Button>
                  <Tooltip title={isDefault ? "The default format can't be deleted" : ""}>
                    <span>
                      <Button size="small" color="error" disabled={busy || isDefault} onClick={() => deleteRow(f)}>
                        Delete
                      </Button>
                    </span>
                  </Tooltip>
                </TableCell>
              </TableRow>
            );
          })}
          {formats && formats.length === 0 && (
            <TableRow>
              <TableCell colSpan={5} sx={{ color: "text.disabled" }}>
                No formats yet — seed the default format on /admin/jobs, or make one below.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      <Stack direction="row" spacing={1.5} useFlexGap sx={{ mt: 2, alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          size="small"
          label="New format name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
          sx={{ minWidth: 240 }}
        />
        <FormatSourceSelect
          label="Duplicate from"
          value={from}
          onChange={setFrom}
          channels={channels}
          formats={formats ?? []}
          disabled={busy}
        />
        <Button variant="outlined" onClick={makeNew} disabled={busy || !name.trim() || !from}>
          New format
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mt: 1.5 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {made && !error && (
        <Alert
          severity="success"
          sx={{ mt: 1.5 }}
          action={
            <Button size="small" component={Link} href={editorHref(made.id)}>
              Open editor
            </Button>
          }
        >
          Made “{made.name}”.
        </Alert>
      )}
    </Paper>
  );
}

/** Measurements, so mono + tabular — the columns must align. */
const numCell = { textAlign: "right", fontFamily: font.mono, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
const numHead = { textAlign: "right" } as const;
