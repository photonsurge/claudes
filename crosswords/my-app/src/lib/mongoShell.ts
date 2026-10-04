import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const getMongoTarget = () => {
  const uri = process.env.MONGO_URI ?? "mongodb://localhost:27017";
  const dbName = process.env.MONGO_DB ?? "crossword";

  // If URI already has a path segment after host, keep it; otherwise append dbName.
  const hasDbInUri = /^mongodb(?:\+srv)?:\/\/[^/]+\/[^/?]+(?:\?.*)?$/i.test(uri);
  if (hasDbInUri) {
    return uri;
  }
  return `${uri.replace(/\/+$/, "")}/${dbName}`;
};

export const runMongoEval = async <T>(script: string): Promise<T> => {
  const target = getMongoTarget();
  const { stdout, stderr } = await execFileAsync(
    "mongosh",
    [target, "--quiet", "--eval", script],
    { maxBuffer: 1024 * 1024 * 20 }
  );

  const err = stderr?.trim();
  if (err) {
    throw new Error(`mongosh error: ${err}`);
  }

  const out = stdout?.trim();
  if (!out) {
    throw new Error("mongosh returned no output");
  }

  return JSON.parse(out) as T;
};
