const isProd = () => process.env.NODE_ENV === "production";

type LogLevel = "info" | "warn" | "error" | "debug";

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
    else console.log("[info]", ...args);
  },
  warn(...args: unknown[]) {
    if (isProd()) console.warn(prodLine("warn", args));
    else console.warn("[warn]", ...args);
  },
  error(...args: unknown[]) {
    if (isProd()) console.error(prodLine("error", args));
    else console.error("[error]", ...args);
  },
  debug(...args: unknown[]) {
    if (isProd()) console.log(prodLine("debug", args));
    else console.debug("[debug]", ...args);
  },
};

// Legacy compat helpers — `log(tag, ...)` style.
export const log = (...args: unknown[]) => logger.info(...args);
export const logWarn = (...args: unknown[]) => logger.warn(...args);
export const logError = (...args: unknown[]) => logger.error(...args);
