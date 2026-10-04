import { Button, MenuItem, Paper, Stack, TextField } from "@mui/material";

type Props = {
  q: string;
  sort: string;
  limit: number;
  pageSizeOptions: number[];
};

const MysteriesFilters = ({ q, sort, limit, pageSizeOptions }: Props) => {
  return (
    <Paper variant="outlined" sx={{ p: 1.5 }}>
      <Stack component="form" direction={{ xs: "column", md: "row" }} gap={1.5} alignItems={{ xs: "stretch", md: "center" }}>
        <TextField name="q" defaultValue={q} label="Search" placeholder="title/logline/story" size="small" />
        <TextField name="limit" defaultValue={String(limit)} label="Per page" select size="small" sx={{ minWidth: 140 }}>
          {pageSizeOptions.map((n) => (
            <MenuItem key={n} value={n}>
              {n}
            </MenuItem>
          ))}
        </TextField>
        <TextField name="sort" defaultValue={sort} label="Order by" select size="small" sx={{ minWidth: 200 }}>
          <MenuItem value="updated_desc">updated newest</MenuItem>
          <MenuItem value="updated_asc">updated oldest</MenuItem>
          <MenuItem value="created_desc">created newest</MenuItem>
          <MenuItem value="created_asc">created oldest</MenuItem>
          <MenuItem value="title_asc">title A-Z</MenuItem>
          <MenuItem value="title_desc">title Z-A</MenuItem>
        </TextField>
        <Button type="submit" variant="contained">
          Apply
        </Button>
      </Stack>
    </Paper>
  );
};

export default MysteriesFilters;
