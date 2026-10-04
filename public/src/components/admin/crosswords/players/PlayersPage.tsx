"use client";

/**
 * /admin/crosswords/players — everyone who has answered on a crossword
 * channel, with all-time points and words (docs/crossword-mode-plan.md §8.3).
 * Hide takes a player off the boards and makes the host ignore their answers;
 * Unhide puts them back. Simulator players (`sim:…`) are marked.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
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
import Typography from "@mui/material/Typography";
import type { CrosswordPlayerRow } from "@photonsurge/shared/crossword-records";
import AdminPageShell from "../../AdminPageShell";
import { font } from "../../../../theme/tokens";
import { fmtTime, listPlayers, setPlayerHidden } from "../puzzles/api";

type Sort = "points" | "lastSeen";

export default function PlayersPage() {
  const [players, setPlayers] = useState<CrosswordPlayerRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<Sort>("points");

  const refresh = useCallback(async () => {
    const res = await listPlayers();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setPlayers(res.data.players);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const rows = (players ?? []).filter((p) => !q || p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q));
    return [...rows].sort((a, b) =>
      sort === "points" ? b.points - a.points || b.words - a.words || a.name.localeCompare(b.name) : b.lastSeen - a.lastSeen,
    );
  }, [players, search, sort]);

  const toggle = async (p: CrosswordPlayerRow) => {
    setBusy(p.id);
    setActionError(null);
    const res = await setPlayerHidden(p.id, !p.hidden);
    setBusy(null);
    if (!res.ok) {
      setActionError(res.error);
      return;
    }
    setPlayers((all) => (all ?? []).map((x) => (x.id === p.id ? { ...x, hidden: res.data.hidden } : x)));
  };

  return (
    <AdminPageShell
      title="Players"
      description="Everyone who has answered on a crossword channel, with all-time totals. A hidden player is left off the boards and their answers are ignored."
      maxWidth={1200}
      crumbs={[{ href: "/admin/crosswords", label: "Crosswords" }, { label: "Players" }]}
      actions={
        <Button variant="outlined" onClick={() => refresh()}>
          Refresh
        </Button>
      }
    >
      <Stack spacing={1.75}>
        <Stack direction="row" spacing={1.25}>
          <TextField size="small" label="Search" value={search} onChange={(e) => setSearch(e.target.value)} sx={{ minWidth: 240 }} />
          <TextField select size="small" label="Sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} slotProps={{ select: { native: true } }}>
            <option value="points">Points</option>
            <option value="lastSeen">Last seen</option>
          </TextField>
        </Stack>
        {error && <Alert severity="error">Couldn&apos;t load players: {error}</Alert>}
        {actionError && (
          <Alert severity="error" onClose={() => setActionError(null)}>
            {actionError}
          </Alert>
        )}
        {!players ? (
          <Typography color="text.secondary">{error ? "" : "Loading…"}</Typography>
        ) : (
          <Paper sx={{ p: 1.75 }}>
            <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
              Players ({shown.length})
            </Typography>
            <Table size="small" sx={{ mt: 1 }}>
              <TableHead>
                <TableRow>
                  <TableCell>Name</TableCell>
                  <TableCell>Id</TableCell>
                  <TableCell sx={numHead}>Points</TableCell>
                  <TableCell sx={numHead}>Words</TableCell>
                  <TableCell>First seen</TableCell>
                  <TableCell>Last seen</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {shown.map((p) => (
                  <TableRow key={p.id} hover sx={p.hidden ? { opacity: 0.55 } : undefined}>
                    <TableCell sx={{ fontWeight: 600 }}>
                      {p.name}
                      {p.id.startsWith("sim:") && <Chip size="small" label="sim" variant="outlined" sx={{ ml: 0.75 }} />}
                      {p.hidden && <Chip size="small" label="hidden" color="warning" variant="outlined" sx={{ ml: 0.75 }} />}
                    </TableCell>
                    <TableCell sx={{ fontFamily: font.mono, fontSize: 12, color: "text.secondary" }}>{p.id}</TableCell>
                    <TableCell sx={numCell}>{p.points}</TableCell>
                    <TableCell sx={numCell}>{p.words}</TableCell>
                    <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{fmtTime(p.firstSeen)}</TableCell>
                    <TableCell sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>{fmtTime(p.lastSeen)}</TableCell>
                    <TableCell align="right">
                      <Button size="small" color={p.hidden ? "primary" : "warning"} disabled={busy === p.id} onClick={() => toggle(p)}>
                        {p.hidden ? "Unhide" : "Hide"}
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {!shown.length && (
                  <TableRow>
                    <TableCell colSpan={7} sx={{ color: "text.disabled" }}>
                      {players.length ? "No player matches." : "No players yet. Answers from chat or the Desk's simulator add them."}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Paper>
        )}
      </Stack>
    </AdminPageShell>
  );
}

const numCell = { textAlign: "right", fontFamily: font.mono, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" } as const;
const numHead = { textAlign: "right" } as const;
