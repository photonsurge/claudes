"use client";

import { useEffect, useState } from "react";
import { Alert, CircularProgress, Container, Stack, Typography } from "@mui/material";
import MysteryDetailView from "./MysteryDetailView";
import { MysteryDetail } from "./types";

type DetailResponse = {
  mystery: MysteryDetail;
  error?: string;
};

const MysteryDetailClient = ({ id }: { id: string }) => {
  const [data, setData] = useState<DetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setNotFound(false);

    fetch(`/api/mysteries/${encodeURIComponent(id)}`, { signal: ctrl.signal })
      .then(async (r) => {
        const body = (await r.json()) as DetailResponse;
        if (r.status === 404) {
          setNotFound(true);
          return;
        }
        if (!r.ok) throw new Error(body.error ?? "Failed to load mystery");
        setData(body);
      })
      .catch((e: any) => {
        if (e?.name !== "AbortError") setError(e?.message ?? "Failed to load mystery");
      })
      .finally(() => setLoading(false));

    return () => ctrl.abort();
  }, [id]);

  if (loading) {
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Stack direction="row" gap={1} alignItems="center">
          <CircularProgress size={18} />
          <Typography variant="body2">Loading mystery...</Typography>
        </Stack>
      </Container>
    );
  }

  if (notFound) {
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Typography>Not found</Typography>
      </Container>
    );
  }

  if (error) {
    return (
      <Container maxWidth="md" sx={{ py: 3 }}>
        <Alert severity="error">{error}</Alert>
      </Container>
    );
  }

  if (!data) return null;

  return (
    <Container maxWidth="md" sx={{ py: 3 }}>
      <MysteryDetailView mystery={data.mystery} />
    </Container>
  );
};

export default MysteryDetailClient;
