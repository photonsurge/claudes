"use client";

/**
 * /admin/crosswords/words — the February word bank, browsed
 * (docs/crossword-mode-plan.md §8.3): totals above, filters, one page of words.
 * The filters live in the query string (read on mount, written back on every
 * change, followed on back/forward) so a view is linkable. Decisions are on the detail page and in the approval queue; on an
 * empty bank it shows the import command instead of a table.
 */
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import type { BankWordQuery } from "@photonsurge/shared/crossword-bank";
import AdminPageShell from "../../AdminPageShell";
import { font } from "../../../../theme/tokens";
import { getBankWords } from "./api";
import BankTotalsStrip from "./BankTotalsStrip";
import PoolCounter from "./PoolCounter";
import { BANK_IMPORT_COMMAND, bankQueryString, parseBankQuery, type BankWordsResponse } from "./query";
import WordsFilters from "./WordsFilters";
import WordsTable from "./WordsTable";

const readQuery = (): BankWordQuery => parseBankQuery(new URLSearchParams(window.location.search));

export function BankNotImported() {
  return (
    <Alert severity="info">
      <Typography variant="body2" sx={{ mb: 1 }}>
        The word bank isn&apos;t imported on this box. Load the February dump&apos;s <code>words</code> and{" "}
        <code>clues</code> collections as <code>crosswordbankwords</code> and <code>crosswordbankclues</code>, then
        build the indexes with <code>yarn crossword:bank-index</code> (or its button on /admin/jobs):
      </Typography>
      <Box component="pre" sx={{ m: 0, fontFamily: font.mono, fontSize: 12, whiteSpace: "pre-wrap" }}>
        {BANK_IMPORT_COMMAND}
      </Box>
    </Alert>
  );
}

export default function WordsPage() {
  const [query, setQuery] = useState<BankWordQuery | null>(null);
  const [data, setData] = useState<BankWordsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    setQuery(readQuery());
    const onPop = () => setQuery(readQuery());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  useEffect(() => {
    if (!query) return;
    let live = true;
    setLoading(true);
    getBankWords(query).then((res) => {
      if (!live) return;
      setLoading(false);
      if (res.ok) {
        setData(res.data);
        setError(null);
      } else setError(res.error);
    });
    return () => {
      live = false;
    };
  }, [query, nonce]);

  const change = useCallback((q: BankWordQuery) => {
    const qs = bankQueryString(q);
    window.history.pushState(null, "", `${window.location.pathname}${qs ? `?${qs}` : ""}`);
    setQuery(q);
  }, []);

  const page = data?.page ?? 1;
  const pageSize = data?.pageSize ?? 50;
  const lastPage = data ? Math.max(1, Math.ceil(data.total / pageSize)) : 1;
  const from = data && data.total ? (page - 1) * pageSize + 1 : 0;
  const to = data ? Math.min(data.total, page * pageSize) : 0;

  return (
    <AdminPageShell
      title="Words"
      description="The imported crossword word bank: every word, its clue status, approval, family-friendly tag, validation verdict and frequency. Open a word to approve it and its clues."
      maxWidth={1600}
      crumbs={[{ href: "/admin/crosswords", label: "Crosswords" }, { label: "Words" }]}
      actions={
        <>
          <Button variant="contained" component={Link} href="/admin/crosswords/approve">
            Approval queue
          </Button>
          <Button variant="outlined" onClick={() => setNonce((n) => n + 1)}>
            Refresh
          </Button>
        </>
      }
    >
      <Stack spacing={1.75}>
        {error && <Alert severity="error">Couldn&apos;t load words: {error}</Alert>}
        {!data || !query ? (
          <Typography color="text.secondary">{error ? "" : "Loading…"}</Typography>
        ) : !data.imported ? (
          <BankNotImported />
        ) : (
          <>
            <PoolCounter pool={data.pool} />
            <BankTotalsStrip totals={data.totals} />
            <WordsFilters query={query} onChange={change} />
            <Stack direction="row" sx={{ alignItems: "center", gap: 1.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ fontVariantNumeric: "tabular-nums" }}>
                {data.total ? `${from.toLocaleString("en-GB")}–${to.toLocaleString("en-GB")} of ${data.total.toLocaleString("en-GB")}` : "0 words"}
                {loading ? " · loading…" : ""}
              </Typography>
              <Box sx={{ ml: "auto" }} />
              <Button size="small" disabled={page <= 1} onClick={() => change({ ...query, page: page - 1 })}>
                Previous
              </Button>
              <Typography variant="body2">
                Page {page} of {lastPage.toLocaleString("en-GB")}
              </Typography>
              <Button size="small" disabled={page >= lastPage} onClick={() => change({ ...query, page: page + 1 })}>
                Next
              </Button>
            </Stack>
            <WordsTable rows={data.rows} />
          </>
        )}
      </Stack>
    </AdminPageShell>
  );
}
