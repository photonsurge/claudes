/**
 * Worker back-log helpers — thin wrappers over the shared BackLogger that saves
 * directly to Mongo (no queue). Use `blogInfo` for "ok" outcomes and `blogErr`
 * in catch blocks so every worker event lands in /admin/logs.
 */
import { WorkerBackLogger } from "@photonsurge/shared/utill/BackLogger";
import { summarizeForLog } from "./utils";

export const blogInfo = (
  tag: string,
  message: string,
  stuff: unknown = {},
  type = "unknown",
  targetID = "unknown",
) => WorkerBackLogger("worker", "info", tag, message, stuff, type, targetID);

export const blogErr = (
  tag: string,
  message: string,
  err: unknown,
  type = "unknown",
  targetID = "unknown",
) => WorkerBackLogger("worker", "error", tag, message, summarizeForLog(err), type, targetID);
