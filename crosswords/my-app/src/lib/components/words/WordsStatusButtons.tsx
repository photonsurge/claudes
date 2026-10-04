import { Button, Stack } from "@mui/material";

type Props = {
  q: string;
  limit: number;
  sort: string;
  approvedOnly: boolean;
  currentStatus: string;
  statusTotals?: Record<string, number>;
  fmt: Intl.NumberFormat;
};

const STATUS_KEYS = ["pending", "done", "rejected", "failed", "unknown"] as const;

const WordsStatusButtons = ({ q, limit, sort, approvedOnly, currentStatus, statusTotals, fmt }: Props) => {
  const hrefForStatus = (nextStatus: string) =>
    `/words?status=${encodeURIComponent(nextStatus)}&q=${encodeURIComponent(q)}&page=1&limit=${encodeURIComponent(String(limit))}&sort=${encodeURIComponent(sort)}&approved=${approvedOnly ? "1" : "0"}`;
  const all = Object.values(statusTotals ?? {}).reduce((sum, n) => sum + Number(n || 0), 0);

  return (
    <Stack direction="row" gap={1} flexWrap="wrap">
      <Button href={hrefForStatus("")} size="small" variant={currentStatus === "" ? "contained" : "outlined"}>
        all: {fmt.format(all)}
      </Button>
      {STATUS_KEYS.map((k) => (
        <Button
          key={k}
          href={hrefForStatus(k)}
          size="small"
          variant={currentStatus === k ? "contained" : "outlined"}
        >
          {k}: {fmt.format(Number(statusTotals?.[k] ?? 0))}
        </Button>
      ))}
    </Stack>
  );
};

export default WordsStatusButtons;
