"use client";

/**
 * /admin/crosswords/puzzles — the puzzle stock (docs/crossword-mode-plan.md
 * §8.3): filter by status, source and theme, open one to review it, and
 * Generate now for a channel. Builds run in the background, so the list is
 * refreshed by hand (or after a queued build, once).
 */
import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import AdminPageShell from "../../AdminPageShell";
import GenerateForm from "./GenerateForm";
import PuzzlesTable from "./PuzzlesTable";
import { listPuzzles, type PuzzleFilters, type PuzzleRow } from "./api";

export default function PuzzlesPage() {
  const [filters, setFilters] = useState<PuzzleFilters>({ status: "", source: "", theme: "" });
  const [rows, setRows] = useState<PuzzleRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await listPuzzles(filters);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setError(null);
    setRows(res.data.puzzles);
  }, [filters]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const set = (patch: Partial<PuzzleFilters>) => setFilters((f) => ({ ...f, ...patch }));

  return (
    <AdminPageShell
      title="Puzzles"
      description="Crossword puzzles built for the channels. A draft airs only once approved (or under a channel's auto-approve)."
      maxWidth={1400}
      crumbs={[{ href: "/admin/crosswords", label: "Crosswords" }, { label: "Puzzles" }]}
      actions={
        <Button variant="outlined" onClick={() => refresh()}>
          Refresh
        </Button>
      }
    >
      <Stack spacing={1.75}>
        <GenerateForm onQueued={() => refresh()} />

        <Stack direction={{ xs: "column", sm: "row" }} spacing={1.25}>
          <TextField select size="small" label="Status" value={filters.status} onChange={(e) => set({ status: e.target.value as PuzzleFilters["status"] })} sx={{ minWidth: 160 }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="draft">Draft</MenuItem>
            <MenuItem value="ready">Ready</MenuItem>
            <MenuItem value="rejected">Rejected</MenuItem>
          </TextField>
          <TextField select size="small" label="Source" value={filters.source} onChange={(e) => set({ source: e.target.value as PuzzleFilters["source"] })} sx={{ minWidth: 160 }}>
            <MenuItem value="">All</MenuItem>
            <MenuItem value="bank">Bank</MenuItem>
            <MenuItem value="themed">Themed</MenuItem>
            <MenuItem value="seed">Seed</MenuItem>
          </TextField>
          <TextField
            size="small"
            label="Theme or title"
            value={filters.theme}
            onChange={(e) => set({ theme: e.target.value })}
            sx={{ minWidth: 220 }}
          />
        </Stack>

        {error && <Alert severity="error">Couldn&apos;t load puzzles: {error}</Alert>}
        {rows ? <PuzzlesTable puzzles={rows} /> : <Typography color="text.secondary">{error ? "" : "Loading…"}</Typography>}
      </Stack>
    </AdminPageShell>
  );
}
