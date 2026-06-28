import dotenv from "dotenv";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

type LoadEnvOptions = {
  cwd?: string;
  serviceDir?: string;
};

export const getEnvFileCandidates = (options: LoadEnvOptions = {}): string[] => {
  const cwd = options.cwd ?? process.cwd();
  const serviceDir = options.serviceDir ?? resolve(__dirname, "..");

  return Array.from(
    new Set([
      resolve(serviceDir, "../.env"), // repo root (shared by all services)
      resolve(cwd, ".env"),
      resolve(serviceDir, ".env"),
    ]),
  );
};

/**
 * Loads .env files without overriding variables already present in the
 * environment (real env always wins over file values).
 */
export const loadWorkerEnv = (options: LoadEnvOptions = {}): string[] => {
  const lockedKeys = new Set(
    Object.keys(process.env).filter((key) => process.env[key] !== undefined),
  );
  const loadedFiles: string[] = [];

  for (const envPath of getEnvFileCandidates(options)) {
    if (!existsSync(envPath)) continue;
    const parsed = dotenv.parse(readFileSync(envPath));
    for (const [key, value] of Object.entries(parsed)) {
      if (lockedKeys.has(key)) continue;
      process.env[key] = value;
    }
    loadedFiles.push(envPath);
  }

  return loadedFiles;
};
