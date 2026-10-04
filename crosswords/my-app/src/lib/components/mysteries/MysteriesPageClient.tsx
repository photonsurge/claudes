"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Alert, CircularProgress, Container, Paper, Stack, Typography } from "@mui/material";
import MysteriesFilters from "./MysteriesFilters";
import MysteriesPager from "./MysteriesPager";
import MysteriesTable from "./MysteriesTable";
import { MysteriesApiResponse } from "./types";

const MysteriesPageClient = () => {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const sort = searchParams.get("sort") ?? "updated_desc";
  const pageNum = Math.max(1, Number(searchParams.get("page") ?? "1") || 1);
  const limitNum = Math.max(1, Number(searchParams.get("limit") ?? "20") || 20);
  const fmt = useMemo(() => new Intl.NumberFormat("en-US"), []);
  const pageSizeOptions = [20, 50, 100];

  const query = useMemo(
    () =>
      new URLSearchParams({
        q,
        sort,
        page: String(pageNum),
        limit: String(limitNum),
      }).toString(),
    [q, sort, pageNum, limitNum]
  );

  const [data, setData] = useState<MysteriesApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    fetch(`/api/mysteries?${query}`, { signal: ctrl.signal })
      .then(async (r) => {
        const body = (await r.json()) as MysteriesApiResponse & { error?: string };
        if (!r.ok || !body.ok) throw new Error(body.error ?? "Failed to load mysteries");
        setData(body);
      })
      .catch((e: any) => {
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load mysteries");
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [query]);

  const totalPages = Math.max(1, Math.ceil((Number(data?.total) || 0) / (Number(data?.limit) || limitNum)));
  const currentPage = Math.min(totalPages, Math.max(1, Number(data?.page) || pageNum));

  const hrefForPage = (p: number) =>
    `/mysteries?q=${encodeURIComponent(q)}&page=${p}&limit=${encodeURIComponent(String(limitNum))}&sort=${encodeURIComponent(sort)}`;
  const hrefForSort = (nextSort: string) =>
    `/mysteries?q=${encodeURIComponent(q)}&page=1&limit=${encodeURIComponent(String(limitNum))}&sort=${encodeURIComponent(nextSort)}`;

  return (
    <Container maxWidth="lg" sx={{ py: 3 }}>
      <Stack gap={2}>
        <Typography variant="h4">Mysteries</Typography>

        <MysteriesFilters q={q} sort={sort} limit={limitNum} pageSizeOptions={pageSizeOptions} />

        {loading ? (
          <Paper variant="outlined" sx={{ p: 2 }}>
            <Stack direction="row" gap={1} alignItems="center">
              <CircularProgress size={18} />
              <Typography variant="body2">Loading mysteries...</Typography>
            </Stack>
          </Paper>
        ) : null}

        {error ? <Alert severity="error">{error}</Alert> : null}

        {!loading && !error && data ? (
          <>
            <Paper variant="outlined" sx={{ p: 1.5 }}>
              <Typography variant="body2" color="text.secondary">
                total: {fmt.format(Number(data.total) || 0)} • page {fmt.format(currentPage)} / {fmt.format(totalPages)} • showing{" "}
                {fmt.format(data.items?.length ?? 0)} • {fmt.format(Number(data.limit) || limitNum)}/page
              </Typography>
            </Paper>

            <MysteriesTable items={data.items} sort={sort} hrefForSort={hrefForSort} />

            <MysteriesPager currentPage={currentPage} totalPages={totalPages} hrefForPage={hrefForPage} fmt={fmt} />
          </>
        ) : null}
      </Stack>
    </Container>
  );
};

export default MysteriesPageClient;
