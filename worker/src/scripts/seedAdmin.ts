// Bootstrap the first admin account from env vars. Idempotent — safe to
// re-run; no-ops (never overwrites) if the email already exists.
//
//   cd worker && ADMIN_EMAIL=you@example.com ADMIN_PASSWORD=... yarn seed:admin
import { loadWorkerEnv } from "../loadEnv";
loadWorkerEnv();

import { getAppDb } from "@photonsurge/shared/db/index";
import { hashPassword } from "@photonsurge/shared/utill/password";

(async () => {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.error("[seedAdmin] ADMIN_EMAIL and ADMIN_PASSWORD must be set");
    process.exit(1);
  }

  const db = await getAppDb();
  const existing = await db.users.findByEmail(email);
  if (existing) {
    console.log(`[seedAdmin] ${email} already exists — no-op`);
    setTimeout(() => process.exit(0), 250);
    return;
  }

  const passwordHash = await hashPassword(password);
  await db.users.create({ email, passwordHash, role: "admin" });
  console.log(`[seedAdmin] created admin ${email}`);
  setTimeout(() => process.exit(0), 250);
})().catch((err) => {
  console.error("[seedAdmin]", err);
  process.exit(1);
});
