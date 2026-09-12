/**
 * YouTube Data API quota meter + pacing.
 *
 * Google gives a project 10,000 units/day (resetting at midnight Pacific) and
 * bills EVERY call, failed ones included. The streaming feature's steady-state
 * spend is dominated by live-chat polling — `liveChatMessages.list` at the
 * server-suggested 2–5 s cadence is ~90k units/day PER live run — so without a
 * meter the quota is gone a few hours into each day and every YouTube call
 * (health, go-live, the slot recycle, end-of-run) fails with `quotaExceeded`
 * until 08:00 UK time. This module:
 *
 *  - counts units per connected account per Pacific day (Redis, reusing the
 *    BullMQ ioredis client like weather/panels.ts — survives a worker restart;
 *    falls back to an in-memory counter if Redis is unavailable);
 *  - remembers a `quotaExceeded` verdict until the next reset so callers can
 *    short-circuit instead of burning a round-trip (and a log line) per tick;
 *  - derives a chat poll floor from what is LEFT of the day's budget, so chat
 *    never spends the units go-live/end need (`YOUTUBE_QUOTA_RESERVE`) and a
 *    raised quota (Google audit) speeds chat back up with a single env change.
 *
 * The meter only sees THIS worker's spend. Quota is per Google Cloud project, so
 * anything else on the same project also draws from it — the 403 is the ground
 * truth, the meter is the early warning.
 */
import { getQueue } from "@photonsurge/shared/bull/bull";
import { log } from "@photonsurge/shared/utill/logger";

const TAG = "youtube-quota";

/** Units per call. `liveChatMessages.list` is env-overridable — see YOUTUBE_QUOTA_COST_CHAT_LIST. */
const BASE_COST = {
  "channels.list": 1,
  "videos.list": 1,
  "videos.update": 50,
  "thumbnails.set": 50,
  "liveBroadcasts.list": 1,
  "liveBroadcasts.insert": 50,
  "liveBroadcasts.bind": 50,
  "liveBroadcasts.transition": 50,
  "liveBroadcasts.delete": 50,
  "liveStreams.list": 1,
  "liveStreams.insert": 50,
  "liveChatMessages.list": 5,
  "liveChatMessages.insert": 50,
} as const;
export type YoutubeOp = keyof typeof BASE_COST;

const envNum = (name: string, dflt: number): number => {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n >= 0 ? n : dflt;
};

export function quotaCost(op: YoutubeOp): number {
  if (op === "liveChatMessages.list") return envNum("YOUTUBE_QUOTA_COST_CHAT_LIST", BASE_COST[op]);
  return BASE_COST[op];
}
/** The project's daily allowance (raise after Google grants an extension). */
export const dailyBudget = (): number => envNum("YOUTUBE_QUOTA_DAILY", 10_000);
/** Units kept back for go-live / end-of-run (each cycle ≈ 200) — chat never eats these. */
export const lifecycleReserve = (): number => envNum("YOUTUBE_QUOTA_RESERVE", 1_500);
/** Fraction of the remaining non-reserved budget chat polling may spend (0–1). */
export const chatShare = (): number => Math.min(1, Math.max(0, envNum("YOUTUBE_CHAT_QUOTA_SHARE", 0.6)));

// ---- Pacific-day arithmetic (the quota resets at midnight America/Los_Angeles) ----

const PT_ZONE = "America/Los_Angeles";
const ptFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: PT_ZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function ptParts(ms: number) {
  const p: Record<string, string> = {};
  for (const part of ptFmt.formatToParts(new Date(ms))) p[part.type] = part.value;
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}

/** Calendar day in Pacific time, e.g. "2026-09-07" — the meter's bucket key. */
export function pacificDayKey(now = Date.now()): string {
  const { y, m, d } = ptParts(now);
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Epoch ms of the next midnight in Pacific time (= next quota reset). */
export function nextPacificMidnight(now = Date.now()): number {
  const p = ptParts(now);
  const wallNowAsUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi, p.s);
  const offset = wallNowAsUtc - Math.floor(now / 1000) * 1000; // PT wall clock − UTC, in ms
  let candidate = Date.UTC(p.y, p.m - 1, p.d + 1, 0, 0, 0) - offset;
  // A DST switch between now and midnight moves the offset by an hour — re-derive once.
  const c = ptParts(candidate);
  if (c.h !== 0) candidate -= (c.h >= 12 ? c.h - 24 : c.h) * 3_600_000;
  return candidate;
}

// ---- Store (Redis with in-memory fallback; both fail-open) ----

export interface QuotaStore {
  incrBy(key: string, by: number, expireAt: number): Promise<number>;
  getNumber(key: string): Promise<number | null>;
  setNumber(key: string, value: number, expireAt: number): Promise<void>;
  del(key: string): Promise<void>;
}

export class MemoryQuotaStore implements QuotaStore {
  private readonly map = new Map<string, { v: number; exp: number }>();
  private live(key: string) {
    const e = this.map.get(key);
    if (!e) return null;
    if (e.exp <= Date.now()) {
      this.map.delete(key);
      return null;
    }
    return e;
  }
  async incrBy(key: string, by: number, expireAt: number) {
    const cur = this.live(key);
    const v = (cur?.v ?? 0) + by;
    this.map.set(key, { v, exp: cur?.exp ?? expireAt });
    return v;
  }
  async getNumber(key: string) {
    return this.live(key)?.v ?? null;
  }
  async setNumber(key: string, value: number, expireAt: number) {
    this.map.set(key, { v: value, exp: expireAt });
  }
  async del(key: string) {
    this.map.delete(key);
  }
}

/** ioredis-backed store on the BullMQ connection. Any Redis error → the fallback. */
class RedisQuotaStore implements QuotaStore {
  private warned = false;
  constructor(
    private readonly client: () => Promise<any>,
    private readonly fallback: QuotaStore,
  ) {}
  private async run<T>(op: (c: any) => Promise<T>, alt: () => Promise<T>): Promise<T> {
    try {
      const c = await this.client();
      if (!c) return alt();
      return await op(c);
    } catch (err) {
      if (!this.warned) {
        this.warned = true;
        log(TAG, "redis unavailable — metering in memory only", String((err as Error)?.message ?? err));
      }
      return alt();
    }
  }
  incrBy(key: string, by: number, expireAt: number) {
    return this.run(
      async (c) => {
        const v = Number(await c.incrby(key, by));
        await c.pexpireat(key, expireAt);
        return v;
      },
      () => this.fallback.incrBy(key, by, expireAt),
    );
  }
  getNumber(key: string) {
    return this.run(
      async (c) => {
        const raw = await c.get(key);
        return raw == null ? null : Number(raw);
      },
      () => this.fallback.getNumber(key),
    );
  }
  setNumber(key: string, value: number, expireAt: number) {
    return this.run(
      async (c) => {
        await c.set(key, String(value));
        await c.pexpireat(key, expireAt);
      },
      () => this.fallback.setNumber(key, value, expireAt),
    );
  }
  del(key: string) {
    return this.run(
      async (c) => {
        await c.del(key);
      },
      () => this.fallback.del(key),
    );
  }
}

let store: QuotaStore | null = null;

function getStore(): QuotaStore {
  if (store) return store;
  const memory = new MemoryQuotaStore();
  store = new RedisQuotaStore(async () => {
    const q: any = getQueue();
    return q?.client ? await q.client : null;
  }, memory);
  return store;
}

/** Tests (and a future admin reset) swap the backing store. */
export function setQuotaStore(s: QuotaStore | null): void {
  store = s;
}

const spentKey = (accountId: string, now: number) => `yt:quota:spent:${accountId}:${pacificDayKey(now)}`;
const exhaustedKey = (accountId: string) => `yt:quota:exhausted:${accountId}`;

/** Record one call's units against today's Pacific-day bucket. Fire-and-forget safe. */
export async function spend(accountId: string, op: YoutubeOp, now = Date.now()): Promise<number> {
  // Keep the bucket an hour past reset so a late read of "yesterday" still works.
  return getStore().incrBy(spentKey(accountId, now), quotaCost(op), nextPacificMidnight(now) + 3_600_000);
}

export async function spentToday(accountId: string, now = Date.now()): Promise<number> {
  return (await getStore().getNumber(spentKey(accountId, now))) ?? 0;
}

/** Remember a `quotaExceeded` verdict until the next reset (or `until`). */
export async function markExhausted(accountId: string, until = nextPacificMidnight()): Promise<void> {
  await getStore().setNumber(exhaustedKey(accountId), until, until);
}

export async function clearExhausted(accountId: string): Promise<void> {
  await getStore().del(exhaustedKey(accountId));
}

/** Epoch ms the block lifts, or null when calls may proceed. */
export async function exhaustedUntil(accountId: string, now = Date.now()): Promise<number | null> {
  const until = await getStore().getNumber(exhaustedKey(accountId));
  return until && until > now ? until : null;
}

export interface QuotaSnapshot {
  budget: number;
  reserve: number;
  spent: number;
  remaining: number;
  resetAt: number;
  exhaustedUntil: number | null;
}

export async function quotaSnapshot(accountId: string, now = Date.now()): Promise<QuotaSnapshot> {
  const budget = dailyBudget();
  const spent = await spentToday(accountId, now);
  return {
    budget,
    reserve: lifecycleReserve(),
    spent,
    remaining: Math.max(0, budget - spent),
    resetAt: nextPacificMidnight(now),
    exhaustedUntil: await exhaustedUntil(accountId, now),
  };
}

// ---- Chat pacing ----

export interface ChatPacing {
  /** Minimum ms between chat polls for ONE run so all live runs together fit the budget. */
  floorMs: number;
  /** Set when the budget is spent: don't poll, re-check after this many ms. */
  pauseMs?: number;
}

/** Longest a paused poller sleeps before re-checking the budget. */
export const CHAT_PAUSE_MAX_MS = 10 * 60_000;

/**
 * Pure pacing rule: spread the chat share of what's left of today's budget evenly
 * over the live chat runs and the time until reset.
 */
export function chatPacingFor(input: {
  spent: number;
  budget: number;
  reserve: number;
  share: number;
  costPerPoll: number;
  liveChatRuns: number;
  now: number;
  resetAt: number;
}): ChatPacing {
  const msLeft = Math.max(1_000, input.resetAt - input.now);
  const remaining = Math.max(0, input.budget - input.spent - input.reserve);
  const perRun = (remaining * input.share) / Math.max(1, input.liveChatRuns);
  const polls = Math.floor(perRun / Math.max(1, input.costPerPoll));
  if (polls < 1) return { floorMs: msLeft, pauseMs: Math.min(msLeft, CHAT_PAUSE_MAX_MS) };
  return { floorMs: Math.ceil(msLeft / polls) };
}

export async function chatPacing(accountId: string, liveChatRuns: number, now = Date.now()): Promise<ChatPacing> {
  const blocked = await exhaustedUntil(accountId, now);
  if (blocked) return { floorMs: blocked - now, pauseMs: Math.min(blocked - now, CHAT_PAUSE_MAX_MS) };
  return chatPacingFor({
    spent: await spentToday(accountId, now),
    budget: dailyBudget(),
    reserve: lifecycleReserve(),
    share: chatShare(),
    costPerPoll: quotaCost("liveChatMessages.list"),
    liveChatRuns,
    now,
    resetAt: nextPacificMidnight(now),
  });
}

/** "07:00 UTC" style stamp for log lines / operator messages. */
export const fmtResetTime = (ms: number): string => `${new Date(ms).toISOString().slice(11, 16)} UTC`;
