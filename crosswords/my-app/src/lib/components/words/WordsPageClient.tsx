"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, Chip, CircularProgress, Container, Paper, Stack, Typography } from "@mui/material";
import WordsFilters from "./WordsFilters";
import WordsPager from "./WordsPager";
import WordsStatusButtons from "./WordsStatusButtons";
import WordsTable from "./WordsTable";
import { WordsApiResponse } from "./types";

const WordsPageClient = () => {
  const searchParams = useSearchParams();
  const status = searchParams.get("status") ?? "";
  const q = searchParams.get("q") ?? "";
  const sort = searchParams.get("sort") ?? "updated_desc";
  const approvedOnly = (searchParams.get("approved") ?? "") === "1";
  const pageNum = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const limitNum = Math.max(1, Number(searchParams.get("limit") ?? "200") || 200);
  const fmt = useMemo(() => new Intl.NumberFormat("en-US"), []);
  const pageSizeOptions = [100, 200, 500, 1000];

  const query = useMemo(
    () =>
      new URLSearchParams({
        status,
        q,
        sort,
        approved: approvedOnly ? "1" : "0",
        page: String(pageNum),
        limit: String(limitNum),
      }).toString(),
    [status, q, sort, approvedOnly, pageNum, limitNum]
  );

  const [data, setData] = useState<WordsApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/words?${query}`, { signal: ctrl.signal })
      .then(async (r) => {
        const body = (await r.json()) as WordsApiResponse & { error?: string };
        if (!r.ok || !body.ok) throw new Error(body.error ?? "Failed to load words");
        setData(body);
      })
      .catch((e: any) => {
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load words");
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [query]);

  const totalPages = Math.max(1, Math.ceil((Number(data?.total) || 0) / (Number(data?.limit) || limitNum)));
  const currentPage = Math.min(totalPages, Math.max(1, Number(data?.page) || pageNum));
  const hrefForPage = (p: number) =>
    `/words?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&page=${p}&limit=${encodeURIComponent(String(limitNum))}&sort=${encodeURIComponent(sort)}&approved=${approvedOnly ? "1" : "0"}`;
  const hrefForSort = (nextSort: string) =>
    `/words?status=${encodeURIComponent(status)}&q=${encodeURIComponent(q)}&page=1&limit=${encodeURIComponent(String(limitNum))}&sort=${encodeURIComponent(nextSort)}&approved=${approvedOnly ? "1" : "0"}`;

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack gap={2}>
        <Typography variant="h4">Words</Typography>

        <WordsFilters
          q={q}
          status={status}
          sort={sort}
          limit={limitNum}
          approvedOnly={approvedOnly}
          pageSizeOptions={pageSizeOptions}
        />

        {loading ? (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" gap={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2">Loading words...</Typography>
            </Stack>
          </Paper>
        ) : null}

        {error ? <Alert severity="error">{error}</Alert> : null}

        {!loading && !error && data ? (
          <>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                total: {fmt.format(Number(data.total) || 0)} • page {fmt.format(currentPage)} / {fmt.format(totalPages)} • showing{" "}
                {fmt.format(data.items?.length ?? 0)} • {fmt.format(Number(data.limit) || limitNum)}/page
              </Typography>
              <Stack direction="row" gap={1} flexWrap="wrap" sx={{ mb: 1.25 }}>
                <Chip label={`approved: ${fmt.format(Number(data.validationTotals?.accepted ?? 0))}`} color="success" size="small" />
                <Chip label={`review: ${fmt.format(Number(data.validationTotals?.review ?? 0))}`} color="warning" size="small" />
                <Chip label={`reject: ${fmt.format(Number(data.validationTotals?.reject ?? 0))}`} color="error" size="small" />
                <Chip label={`unknown: ${fmt.format(Number(data.validationTotals?.unknown ?? 0))}`} variant="outlined" size="small" />
                <Chip label={approvedOnly ? "filter: approved only" : "filter: all words"} variant={approvedOnly ? "filled" : "outlined"} size="small" />
              </Stack>
              <WordsStatusButtons
                q={q}
                limit={limitNum}
                sort={sort}
                approvedOnly={approvedOnly}
                currentStatus={status}
                statusTotals={data.statusTotals}
                fmt={fmt}
              />
            </Paper>

            <WordsTable items={data.items} sort={sort} hrefForSort={hrefForSort} />

            <WordsPager currentPage={currentPage} totalPages={totalPages} hrefForPage={hrefForPage} fmt={fmt} />
          </>
        ) : null}
      </Stack>
    </Container>
  );
};

export default WordsPageClient;
