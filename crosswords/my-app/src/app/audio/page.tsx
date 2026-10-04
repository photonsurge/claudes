"use client"

import AudioTest from "@/lib/components/AudioTest";
import { Container, Paper, Stack, Typography } from "@mui/material";

const AudioPage = () => {
    return (
      <Container maxWidth="md" sx={{ py: 2 }}>
        <Stack gap={1.5}>
          <Typography variant="h5">Audio</Typography>
          <Paper variant="outlined" sx={{ p: 2 }}>
            <AudioTest />
          </Paper>
        </Stack>
      </Container>
    );
};

export default AudioPage;
