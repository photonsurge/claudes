import { Button, Checkbox, FormControlLabel, MenuItem, Paper, Stack, TextField } from "@mui/material";

type Props = {
  q: string;
  status: string;
  sort: string;
  limit: number;
  approvedOnly: boolean;
  pageSizeOptions: number[];
};

const WordsFilters = ({ q, status, sort, limit, approvedOnly, pageSizeOptions }: Props) => {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack component="form" direction={{ xs: "column", md: "row" }} gap={1.5} alignItems={{ xs: "stretch", md: "center" }}>
        <TextField name="q" defaultValue={q} label="Search" placeholder="norm/word" size="small" />
        <TextField name="status" defaultValue={status} label="Status" select size="small" sx={{ minWidth: 160 }}>
          <MenuItem value="">all</MenuItem>
          <MenuItem value="pending">pending</MenuItem>
          <MenuItem value="done">done</MenuItem>
          <MenuItem value="rejected">rejected</MenuItem>
          <MenuItem value="failed">failed</MenuItem>
        </TextField>
        <TextField name="limit" defaultValue={String(limit)} label="Per page" select size="small" sx={{ minWidth: 140 }}>
          {pageSizeOptions.map((n) => (
            <MenuItem key={n} value={n}>
              {n}
            </MenuItem>
          ))}
        </TextField>
        <TextField name="sort" defaultValue={sort} label="Order by" select size="small" sx={{ minWidth: 180 }}>
          <MenuItem value="updated_desc">recent update</MenuItem>
          <MenuItem value="word_asc">word A-Z</MenuItem>
          <MenuItem value="word_desc">word Z-A</MenuItem>
          <MenuItem value="length_asc">length low-high</MenuItem>
          <MenuItem value="length_desc">length high-low</MenuItem>
        </TextField>
        <FormControlLabel
          control={<Checkbox name="approved" value="1" defaultChecked={approvedOnly} />}
          label="Show approved only"
          sx={{ ml: { md: 0.5 } }}
        />
        <Button type="submit" variant="contained">
          Apply
        </Button>
      </Stack>
    </Paper>
  );
};

export default WordsFilters;
