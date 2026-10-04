import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Container, Paper, Stack, Typography } from "@mui/material";

const AccountPage = async () => {
  const session = await auth();

  if (!session?.user) {
    redirect("/login?callbackUrl=/account");
  }

  return (
    <Container maxWidth="sm" sx={{ py: 4 }}>
      <Paper variant="outlined" sx={{ p: 3 }}>
        <Stack gap={1}>
          <Typography variant="h5">Account</Typography>
          <Typography variant="body2">User ID: {session.user.id}</Typography>
          <Typography variant="body2">Name: {session.user.name ?? "-"}</Typography>
          <Typography variant="body2">Email: {session.user.email ?? "-"}</Typography>
        </Stack>
      </Paper>
    </Container>
  );
};

export default AccountPage;
