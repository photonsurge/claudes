import { Button, Stack, Typography } from "@mui/material";

type Props = {
  currentPage: number;
  totalPages: number;
  hrefForPage: (p: number) => string;
  fmt: Intl.NumberFormat;
};

const MysteriesPager = ({ currentPage, totalPages, hrefForPage, fmt }: Props) => {
  return (
    <Stack direction={{ xs: "column", md: "row" }} justifyContent="space-between" alignItems={{ xs: "flex-start", md: "center" }} gap={1}>
      <Typography variant="body2" color="text.secondary">
        page {fmt.format(currentPage)} / {fmt.format(totalPages)}
      </Typography>
      <Stack direction="row" gap={1}>
        <Button href={hrefForPage(1)} size="small" disabled={currentPage <= 1}>
          First
        </Button>
        <Button href={hrefForPage(currentPage - 1)} size="small" disabled={currentPage <= 1}>
          Prev
        </Button>
        <Button href={hrefForPage(currentPage + 1)} size="small" disabled={currentPage >= totalPages}>
          Next
        </Button>
        <Button href={hrefForPage(totalPages)} size="small" disabled={currentPage >= totalPages}>
          Last
        </Button>
      </Stack>
    </Stack>
  );
};

export default MysteriesPager;
