import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  output: "standalone",
  // The app imports a sibling workspace package (@photonsurge/shared via file:),
  // so trace from the repo root. This makes the standalone layout deterministic:
  //   .next/standalone/public/server.js
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
