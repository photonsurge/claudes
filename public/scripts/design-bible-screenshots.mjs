#!/usr/bin/env node
/**
 * Screenshots the real running /watch surface for DESIGN_BIBLE.md, cycling
 * through several director segment kinds and (optionally) broadcast theme
 * re-skins + the /control and /admin surfaces — so the design bible has
 * ground-truth images, not mockups.
 *
 * Needs the dev server up (`yarn dev` in public/, default port 10100) and an
 * admin account (ADMIN_EMAIL/ADMIN_PASSWORD in the repo-root .env — see
 * worker/src/scripts/seedAdmin.ts if you don't have one yet).
 *
 * All broadcast-state mutations (auto-director on/off, skip, theme) go
 * straight to the API (PATCH /api/director/default/config,
 * PATCH /api/broadcast/state) instead of clicking through the /control UI.
 * That's not just simpler — running the heavy /watch globe and the /control
 * globe preview as two simultaneous WebGL tabs in one headless Chromium
 * process was starving each other's render thread and hanging clicks/
 * screenshots. One HTTP call is instant and never contends with anything.
 *
 * This is real, shared, persisted state (Mongo) — the script always puts it
 * back exactly as found, even on failure (see the try/finally below). If you
 * Ctrl-C mid-run, re-run with --revert-only to force it back to the known
 * day-to-day baseline (auto off, aurora theme).
 *
 *   cd public && yarn screenshots:design-bible
 *   cd public && yarn screenshots:design-bible --watch-only    # just /watch segment views
 *   cd public && yarn screenshots:design-bible --revert-only   # just fix state, no shots
 *
 * Playwright drives a real (headless) Chromium — see devDependencies.
 */
import { chromium } from "playwright";
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const OUT_DIR = resolve(REPO_ROOT, "docs/design-bible/gallery");
const BASE = process.env.DESIGN_BIBLE_BASE_URL || "http://localhost:10100";
const SEGMENT_VIEWS = Number(process.env.DESIGN_BIBLE_VIEWS || 8);
const THEMES_TO_SHOOT = ["storm", "command"]; // re-skins beyond the default "aurora"
const REVERT_ONLY = process.argv.includes("--revert-only");
const WATCH_ONLY = process.argv.includes("--watch-only");
const SCENE = "default"; // shared/src/control.ts MAIN_SCENE_ID

const BASELINE_MODE = "off";
const BASELINE_THEME = "aurora";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Pull just the two admin creds out of the root .env without sourcing (or
 *  logging) the whole file — it also has unrelated secrets and a cron
 *  expression that breaks naive shell sourcing. */
async function loadAdminCreds() {
  const envText = await readFile(resolve(REPO_ROOT, ".env"), "utf8");
  const get = (key) => envText.match(new RegExp(`^${key}=(.*)$`, "m"))?.[1]?.trim();
  const email = get("ADMIN_EMAIL");
  const password = get("ADMIN_PASSWORD");
  if (!email || !password) throw new Error("ADMIN_EMAIL / ADMIN_PASSWORD not found in repo-root .env");
  return { email, password };
}

/** Log in via the real login form (so we exercise the same hydration path a
 *  human hits) and hand back the session cookie header for plain fetch(). */
async function login(ctx, { email, password }) {
  const page = await ctx.newPage();
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
  await wait(1000); // let the client component hydrate before typing
  await page.locator('input[type="email"]').first().click();
  await page.locator('input[type="email"]').first().type(email, { delay: 15 });
  await page.locator('input[type="password"]').first().click();
  await page.locator('input[type="password"]').first().type(password, { delay: 15 });
  await page.waitForFunction(() => {
    const b = document.querySelector('button[type="submit"]');
    return b && !b.disabled;
  }, { timeout: 5000 });
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}),
    page.locator('button[type="submit"]').first().click(),
  ]);
  await wait(1000);
  await page.close();

  const cookies = await ctx.cookies();
  const session = cookies.find((c) => c.name === "wc_session");
  if (!session) throw new Error("login did not set wc_session cookie");
  return `wc_session=${session.value}`;
}

async function api(path, { cookie, method = "GET", body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}`);
  return res.json();
}

const getDirectorConfig = (cookie) => api(`/api/director/${SCENE}/config`, { cookie });
const patchDirectorConfig = (cookie, patch) => api(`/api/director/${SCENE}/config`, { cookie, method: "PATCH", body: patch });
const getBroadcastState = (cookie) => api("/api/broadcast/state", { cookie });
const patchBroadcastState = (cookie, patch) => api("/api/broadcast/state", { cookie, method: "PATCH", body: patch });

/** Best-effort — the globe can get slow to produce a stable frame under
 *  headless/software rendering after several segment transitions. One slow
 *  shot shouldn't sink the rest of the run. */
async function shoot(page, path) {
  try {
    await page.screenshot({ path, timeout: 60000 });
    console.log("  ✓", path);
  } catch (err) {
    console.warn("  ✗ skipped (timed out):", path);
  }
}

async function main() {
  const creds = await loadAdminCreds();
  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  const cookie = await login(ctx, creds);

  const originalConfig = await getDirectorConfig(cookie);
  const originalState = await getBroadcastState(cookie);
  const originalMode = originalConfig.mode;
  const originalTheme = originalState.broadcastTheme;

  const revert = async (targetMode = originalMode, targetTheme = originalTheme) => {
    await patchDirectorConfig(cookie, { mode: targetMode });
    await patchBroadcastState(cookie, { broadcastTheme: targetTheme });
    console.log(`Reverted: auto-director → ${targetMode}, theme → ${targetTheme}`);
  };

  if (REVERT_ONLY) {
    await revert(BASELINE_MODE, BASELINE_THEME);
    await browser.close();
    return;
  }

  try {
    const watch = await ctx.newPage();
    await watch.goto(`${BASE}/watch`, { waitUntil: "domcontentloaded" });

    if (originalMode !== "auto") await patchDirectorConfig(cookie, { mode: "auto" });
    await wait(18000); // /watch's own load (globe assets + socket) + first segment landing

    console.log(`Capturing up to ${SEGMENT_VIEWS} /watch segment-kind views…`);
    await shoot(watch, resolve(OUT_DIR, "view-01.png"));
    for (let i = 2; i <= SEGMENT_VIEWS; i++) {
      const cfg = await getDirectorConfig(cookie);
      await patchDirectorConfig(cookie, { skipNonce: cfg.skipNonce + 1 });
      await wait(9000); // 7s transition + buffer
      await shoot(watch, resolve(OUT_DIR, `view-${String(i).padStart(2, "0")}.png`));
    }

    if (!WATCH_ONLY) {
      console.log("Capturing theme re-skins…");
      for (const theme of THEMES_TO_SHOOT) {
        await patchBroadcastState(cookie, { broadcastTheme: theme });
        await wait(2500);
        await shoot(watch, resolve(OUT_DIR, `theme-${theme}.png`));
      }
      await patchBroadcastState(cookie, { broadcastTheme: originalTheme });
      await wait(1500);

      console.log("Capturing /control and /admin…");
      const control = await ctx.newPage();
      await control.goto(`${BASE}/control`, { waitUntil: "domcontentloaded" });
      await wait(3000);
      await shoot(control, resolve(OUT_DIR, "control.png"));
      await control.close();

      const admin = await ctx.newPage();
      await admin.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
      await wait(2000);
      await shoot(admin, resolve(OUT_DIR, "admin-hub.png"));
      await admin.close();
    }
  } finally {
    await revert();
  }

  await browser.close();
  console.log("Done →", OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
