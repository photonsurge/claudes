"use client";

/**
 * The Words list's filters: search, starts-with letter (A–Z strip), clue
 * status, frequency band, the accepted-only and review-only switches, sort and
 * direction, page size. Every change hands back a new query with the page
 * reset; the search box commits after a short pause in typing.
 */
import { useEffect, useRef, useState } from "react";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Stack from "@mui/material/Stack";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import {
  BANK_PAGE_SIZES,
  BANK_ZIPF_BANDS,
  type BankClueStatus,
  type BankSort,
  type BankWordQuery,
  type BankZipfBand,
} from "@photonsurge/shared/crossword-bank";
import { BANK_CLUE_STATUSES, BANK_SORTS } from "./query";

export const SEARCH_DEBOUNCE_MS = 350;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

interface Props {
  query: BankWordQuery;
  onChange: (q: BankWordQuery) => void;
}

export default function WordsFilters({ query, onChange }: Props) {
  const [draft, setDraft] = useState(query.search ?? "");
  const latest = useRef(query);
  latest.current = query;

  // Follow an outside change (back/forward, a reset) into the box.
  useEffect(() => setDraft(query.search ?? ""), [query.search]);

  useEffect(() => {
    const next = draft.trim() || undefined;
    if (next === (latest.current.search ?? undefined)) return;
    const t = setTimeout(() => onChange({ ...latest.current, search: next, page: undefined }), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [draft, onChange]);

  const set = (patch: Partial<BankWordQuery>) => onChange({ ...query, ...patch, page: undefined });

  return (
    <Paper sx={{ p: 1.75 }}>
      <Stack spacing={1.5}>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 1.5, alignItems: "center" }}>
          <TextField
            size="small"
            label="Search"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            sx={{ width: 200 }}
          />
          <TextField
            select
            size="small"
            label="Clue status"
            value={query.clueStatus ?? ""}
            onChange={(e) => set({ clueStatus: (e.target.value || undefined) as BankClueStatus | undefined })}
            sx={{ width: 150 }}
          >
            <MenuItem value="">Any</MenuItem>
            {BANK_CLUE_STATUSES.map((s) => (
              <MenuItem key={s} value={s}>
                {s}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Frequency"
            value={query.band ?? ""}
            onChange={(e) => set({ band: (e.target.value || undefined) as BankZipfBand | undefined })}
            sx={{ width: 180 }}
          >
            <MenuItem value="">Any</MenuItem>
            {BANK_ZIPF_BANDS.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.label}
              </MenuItem>
            ))}
            <MenuItem value="none">No score</MenuItem>
          </TextField>
          <FormControlLabel
            control={
              <Switch
                checked={!!query.acceptedOnly}
                onChange={(e) => set({ acceptedOnly: e.target.checked || undefined, reviewOnly: undefined })}
              />
            }
            label="Accepted only"
          />
          <FormControlLabel
            control={
              <Switch
                checked={!!query.reviewOnly}
                onChange={(e) => set({ reviewOnly: e.target.checked || undefined, acceptedOnly: undefined })}
              />
            }
            label="Review only"
          />
          <TextField
            select
            size="small"
            label="Sort"
            value={query.sort ?? "updated"}
            onChange={(e) => set({ sort: e.target.value === "updated" ? undefined : (e.target.value as BankSort) })}
            sx={{ width: 140 }}
          >
            {BANK_SORTS.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            label="Direction"
            value={query.dir ?? ""}
            onChange={(e) => set({ dir: (e.target.value || undefined) as "asc" | "desc" | undefined })}
            sx={{ width: 130 }}
          >
            <MenuItem value="">Default</MenuItem>
            <MenuItem value="asc">Ascending</MenuItem>
            <MenuItem value="desc">Descending</MenuItem>
          </TextField>
          <TextField
            select
            size="small"
            label="Per page"
            value={String(query.pageSize ?? 50)}
            onChange={(e) => set({ pageSize: Number(e.target.value) === 50 ? undefined : Number(e.target.value) })}
            sx={{ width: 100 }}
          >
            {BANK_PAGE_SIZES.map((s) => (
              <MenuItem key={s} value={String(s)}>
                {s}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        <Stack direction="row" sx={{ flexWrap: "wrap", gap: 0.5 }} role="group" aria-label="Starts with">
          <Button
            size="small"
            variant={query.startsWith ? "text" : "contained"}
            onClick={() => set({ startsWith: undefined })}
            sx={{ minWidth: 40, px: 1 }}
          >
            All
          </Button>
          {LETTERS.map((l) => (
            <Button
              key={l}
              size="small"
              variant={query.startsWith === l ? "contained" : "text"}
              aria-pressed={query.startsWith === l}
              onClick={() => set({ startsWith: query.startsWith === l ? undefined : l })}
              sx={{ minWidth: 28, px: 0.5 }}
            >
              {l}
            </Button>
          ))}
        </Stack>
      </Stack>
    </Paper>
  );
}
