/**
 * Shared structured logger. Emits JSON lines in production and human-readable
 * tagged lines in dev. Exports the `logger` object (info/warn/error/debug) plus
 * legacy `log`/`logWarn`/`logError` aliases used throughout shared and worker.
 */
const isProd = () => process.env.NODE_ENV === "production";

type LogLevel = "info" | "warn" | "error" | "debug";

// Human-readable local time for dev lines, e.g. "17/07 14:03:27.481".
const devTs = () => {
  const d = new Date();
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
};

const prodLine = (level: LogLevel, args: unknown[]) =>
  JSON.stringify({
    level,
    ts: new Date().toISOString(),
    msg: String(args[0]),
    extra: args.length > 1 ? args.slice(1) : undefined,
  });

export const logger = {
  info(...args: unknown[]) {
    if (isProd()) console.log(prodLine("info", args));
    else console.log(devTs(), "[info]", ...args);
  },
  warn(...args: unknown[]) {
    if (isProd()) console.warn(prodLine("warn", args));
    else console.warn(devTs(), "[warn]", ...args);
  },
  error(...args: unknown[]) {
    if (isProd()) console.error(prodLine("error", args));
    else console.error(devTs(), "[error]", ...args);
  },
  debug(...args: unknown[]) {
    if (isProd()) console.log(prodLine("debug", args));
    else console.debug(devTs(), "[debug]", ...args);
  },
};

// Legacy compat helpers — `log(tag, ...)` style.
export const log = (...args: unknown[]) => logger.info(...args);
export const logWarn = (...args: unknown[]) => logger.warn(...args);
export const logError = (...args: unknown[]) => logger.error(...args);
