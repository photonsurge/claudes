import type { NextConfig } from "next";
import path from "path";
import fs from "fs";

// Next only auto-loads .env files from THIS package dir. The stack's single .env
// lives at the repo root (shared by worker/socket/public), so load it here into
// process.env before Next compiles — real environment values always win. This is
// what makes MONGODB_URI, SOCKET_TOKEN_SECRET, NEXT_PUBLIC_SOCKET_URL visible to
// the route handlers and to client-side NEXT_PUBLIC_* inlining.
const rootEnv = path.join(__dirname, "..", ".env");
if (fs.existsSync(rootEnv)) {
  for (const line of fs.readFileSync(rootEnv, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].replace(/\s+$/, "");
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

const nextConfig: NextConfig = {
  output: "standalone",
  // The app imports a sibling workspace package (@photonsurge/shared via file:),
  // so trace from the repo root. This makes the standalone layout deterministic:
  //   .next/standalone/public/server.js
  outputFileTracingRoot: path.join(__dirname, ".."),
};

export default nextConfig;
