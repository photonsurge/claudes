import { Container, Stack, Typography } from "@mui/material";
import ChatTest from "@/lib/components/ChatTest";

const Home = () => {
  return (
    <Container maxWidth="lg" sx={{ py: 2 }}>
      <Stack gap={1.5}>
        <Typography variant="h5">Live Crossword</Typography>
      <ChatTest />
      </Stack>
    </Container>
  );
};

export default Home;
