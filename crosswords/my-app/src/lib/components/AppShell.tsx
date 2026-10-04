"use client";

import { ReactNode } from "react";
import { Box } from "@mui/material";
import { usePathname } from "next/navigation";
import AppNav from "./AppNav";

type Props = {
  children: ReactNode;
};

const AppShell = ({ children }: Props) => {
  const pathname = usePathname();
  const isObs = pathname?.startsWith("/obs");

  if (isObs) return <>{children}</>;

  return (
    <>
      <AppNav />
      <Box sx={{ p: 2 }}>{children}</Box>
    </>
  );
};

export default AppShell;
