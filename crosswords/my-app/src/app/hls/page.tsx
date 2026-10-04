
import WebRTCPlayer from "@/lib/components/WebRTCPlayer";
import { Container, Stack, Typography } from "@mui/material";

const HlsPage = () => {
    return (
      <Container maxWidth="lg" sx={{ py: 2 }}>
        <Stack gap={1.5}>
          <Typography variant="h5">HLS / WebRTC</Typography>
          <WebRTCPlayer />
        </Stack>
      </Container>
    );
};

export default HlsPage;
