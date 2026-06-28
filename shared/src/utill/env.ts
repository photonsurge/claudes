// Tiny env accessor. Centralised so callers don't read process.env directly
// and so we can add aliases/validation later in one place.

const ALIASES: Record<string, string[]> = {
  REDIS_SERVER: ["REDIS_HOST"],
  REDIS_HOST: ["REDIS_SERVER"],
};

export function getEnvVar(name: string): string | undefined {
  const direct = process.env[name];
  if (direct !== undefined && direct !== "") return direct;

  for (const alias of ALIASES[name] ?? []) {
    const value = process.env[alias];
    if (value !== undefined && value !== "") return value;
  }

  return undefined;
}
