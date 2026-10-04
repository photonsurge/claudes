import React from "react";
import { Box } from "@mui/material";

type ChatScrollProps = {
  children: React.ReactNode;
  height?: number | string; // e.g. 420 or "60vh"
};

export const ChatContainer = ({ children, height = 420 }: ChatScrollProps) => {
  const scrollRef = React.useRef<HTMLDivElement | null>(null);
  const bottomRef = React.useRef<HTMLDivElement | null>(null);

  // Track whether user is near bottom (so we only auto-scroll then)
  const isNearBottomRef = React.useRef(true);

  const onScroll = React.useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;

    const thresholdPx = 120; // "near bottom" tolerance
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;

    isNearBottomRef.current = distanceFromBottom < thresholdPx;
  }, []);

  const scrollToBottom = React.useCallback((smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "end" });
  }, []);

  // Auto-scroll on content change *only if* user is near bottom
  React.useLayoutEffect(() => {
    if (isNearBottomRef.current) scrollToBottom(false);
  }, [children, scrollToBottom]);

  return (
    <Box
      ref={scrollRef}
      onScroll={onScroll}
      sx={{
        height,
        maxHeight: height,
        overflowY: "auto",
        px: 2,
        py: 2,
        borderRadius: 3,
        border: "1px solid",
        borderColor: "divider",
        bgcolor: "background.paper",
        boxShadow: "0 8px 30px rgba(0,0,0,0.06)",

        "&::-webkit-scrollbar": { width: 8 },
        "&::-webkit-scrollbar-thumb": {
          backgroundColor: "rgba(0,0,0,0.18)",
          borderRadius: 8,
        },
      }}
    >
      {children}

      {/* sentinel: always exists at bottom */}
      <div ref={bottomRef} />
    </Box>
  );
};
