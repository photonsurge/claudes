import { Box, Paper, Typography } from "@mui/material";
import PrettyJson from "./PrettyJson";

type Props = {
  title: string;
  value: unknown;
};

const JsonPanel = ({ title, value }: Props) => {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, height: "100%" }}>
      <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 700 }}>
        {title}
      </Typography>
      <Box
        sx={{
          p: 1,
          borderRadius: 1,
          bgcolor: "action.hover",
          overflowX: "auto",
        }}
      >
        <PrettyJson value={value ?? null} />
      </Box>
    </Paper>
  );
};

export default JsonPanel;
