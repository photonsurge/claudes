import { Box, Typography } from "@mui/material";

export interface iChatMessage {
  from: string;
  ts: string;
  text: string;
  isMe?: boolean; // optional for alignment later
}

const ChatMessage = ({ text, from, ts, isMe }: iChatMessage) => {
  return (
    <Box
      sx={{
        display: "flex",
        justifyContent: isMe ? "flex-end" : "flex-start",
        mb: 2,
      }}
    >
      <Box
        sx={{
          maxWidth: "75%",
          px: 2,
          py: 1.5,
          borderRadius: 3,
          bgcolor: isMe ? "primary.main" : "background.paper",
          color: isMe ? "primary.contrastText" : "text.primary",
          boxShadow: "0 6px 20px rgba(0,0,0,0.08)",
          backdropFilter: "blur(6px)",
        }}
      >
        {/* Message */}
        <Typography
          variant="body1"
          sx={{ whiteSpace: "pre-wrap", lineHeight: 1.5 }}
        >
          {text}
        </Typography>

        {/* Meta */}
        <Box
          sx={{
            display: "flex",
            justifyContent: "space-between",
            mt: 1,
            gap: 1,
            opacity: 0.7,
            fontSize: 12,
          }}
        >
          <Typography variant="caption">{from}</Typography>
          <Typography variant="caption">{ts}</Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default ChatMessage;