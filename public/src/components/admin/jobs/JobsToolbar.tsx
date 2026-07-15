"use client";

/**
 * Search + group filter for /admin/jobs. The catalog is ~80 jobs across a dozen
 * groups, which is well past "scan the page to find it" — this is how you get to
 * one.
 */
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

interface JobsToolbarProps {
  query: string;
  onQuery: (q: string) => void;
  groups: Array<[string, number]>;
  active: string | null;
  onGroup: (g: string | null) => void;
  total: number;
  shown: number;
}

export default function JobsToolbar({ query, onQuery, groups, active, onGroup, total, shown }: JobsToolbarProps) {
  return (
    <Stack spacing={1.25} sx={{ mb: 2.25 }}>
      <Stack direction="row" spacing={1.25} sx={{ alignItems: "center", flexWrap: "wrap" }}>
        <TextField
          type="search"
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="Search jobs…"
          slotProps={{ htmlInput: { "aria-label": "Search jobs" } }}
          sx={{ flex: "1 1 260px", maxWidth: 380 }}
        />
        <Typography variant="caption" color="text.disabled">
          {shown === total ? `${total} jobs` : `${shown} of ${total} jobs`}
        </Typography>
      </Stack>
      <Stack direction="row" spacing={0.875} useFlexGap sx={{ flexWrap: "wrap" }}>
        <Chip
          label={`All ${total}`}
          onClick={() => onGroup(null)}
          color={active === null ? "primary" : "default"}
          variant={active === null ? "filled" : "outlined"}
        />
        {groups.map(([g, n]) => (
          <Chip
            key={g}
            label={`${g} ${n}`}
            onClick={() => onGroup(active === g ? null : g)}
            color={active === g ? "primary" : "default"}
            variant={active === g ? "filled" : "outlined"}
          />
        ))}
      </Stack>
    </Stack>
  );
}
