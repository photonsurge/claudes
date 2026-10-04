"use client";

/**
 * /admin/crosswords/puzzles/:id — review one puzzle: the grid with every
 * answer, the clues with a link to each word's Words page, and Reject. Clues are edited in Words.
 */
import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { CrosswordPuzzle } from "@photonsurge/shared/crossword";
import AdminPageShell from "../../AdminPageShell";
import ClueTable from "./ClueTable";
import MiniGrid, { answerRows } from "./MiniGrid";
import { FamilyFriendlyChip, STATUS_COLOR } from "./PuzzlesTable";
import { fmtTime, getPuzzle, patchPuzzle, type PuzzlePatch } from "./api";

export default function PuzzleDetailPage({ id }: { id: string }) {
  const [puzzle, setPuzzle] = useState<CrosswordPuzzle | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [focus, setFocus] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getPuzzle(id).then((res) => {
      if (!live) return;
      if (res.ok) setPuzzle(res.data);
      else setLoadError(res.error);
    });
    return () => {
      live = false;
    };
  }, [id]);

  const act = useCallback(
    async (patch: PuzzlePatch) => {
      setBusy(true);
      setActionError(null);
      const res = await patchPuzzle(id, patch);
      setBusy(false);
      if (!res.ok) {
        setActionError(res.error);
        return;
      }
      setPuzzle(res.data);
    },
    [id],
  );

  const title = puzzle ? puzzle.title || puzzle.id : "Puzzle";
  const across = puzzle?.entries.filter((e) => e.dir === "across") ?? [];
  const down = puzzle?.entries.filter((e) => e.dir === "down") ?? [];

  return (
    <AdminPageShell
      title={title}
      maxWidth={1400}
      crumbs={[{ href: "/admin/crosswords", label: "Crosswords" }, { href: "/admin/crosswords/puzzles", label: "Puzzles" }, { label: title }]}
      actions={
        puzzle && (
          <Stack direction="row" spacing={1}>
            <Button variant="outlined" color="error" disabled={busy || puzzle.status === "rejected"} onClick={() => act({ action: "reject" })}>
              Reject
            </Button>
          </Stack>
        )
      }
    >
      {loadError && <Alert severity="error">Couldn&apos;t load the puzzle: {loadError}</Alert>}
      {!puzzle && !loadError && <Typography color="text.secondary">Loading…</Typography>}
      {puzzle && (
        <Stack spacing={1.75}>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", flexWrap: "wrap" }}>
            <Chip size="small" variant="outlined" label={puzzle.status} color={STATUS_COLOR[puzzle.status]} />
            <FamilyFriendlyChip on={puzzle.familyFriendly} />
            <Typography variant="body2" color="text.secondary">
              {puzzle.source} · {puzzle.entries.length} words · {puzzle.width}×{puzzle.height} · built{" "}
              {fmtTime(puzzle.createdAt)} · played {puzzle.plays.length} time{puzzle.plays.length === 1 ? "" : "s"}
            </Typography>
          </Stack>

          {actionError && (
            <Alert severity="error" onClose={() => setActionError(null)}>
              {actionError}
            </Alert>
          )}

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "auto 1fr" }, gap: 1.75, alignItems: "start" }}>
            <Paper sx={{ p: 1.75, overflowX: "auto" }}>
              <MiniGrid
                width={puzzle.width}
                height={puzzle.height}
                rows={answerRows(puzzle)}
                entries={puzzle.entries.map((e) => ({ ...e, length: e.answer.length }))}
                highlight={focus}
                cell={30}
              />
            </Paper>
            <ClueTable entries={[...across, ...down]} onFocus={setFocus} />
          </Box>
        </Stack>
      )}
    </AdminPageShell>
  );
}
