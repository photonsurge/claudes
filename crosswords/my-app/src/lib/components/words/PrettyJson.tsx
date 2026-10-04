import { Box } from "@mui/material";

type Props = {
  value: unknown;
};

const PrettyJson = ({ value }: Props) => {
  const content = value === undefined ? "undefined" : JSON.stringify(value, null, 2);
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
        fontSize: 12,
        lineHeight: 1.5,
        whiteSpace: "pre",
        tabSize: 2,
      }}
    >
      {content}
    </Box>
  );
};

export default PrettyJson;
