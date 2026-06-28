// @photonsurge/shared — shared constants, enums and types.
//
// Single-domain infra (NOT multi-tenant): there is exactly one logical site,
// so there is no master/tenant DB split and no per-domain context resolution.

/** The services that make up the stack. */
export const SYSTEM_TYPE = ["shared", "public", "worker", "socket"] as const;
export type SYSTEM_TYPE = (typeof SYSTEM_TYPE)[number];

/** Actor types that may connect to the socket server. */
export const ACTOR_TYPE = ["user", "worker", "service"] as const;
export type ACTOR_TYPE = (typeof ACTOR_TYPE)[number];

export const LOG_LEVEL = ["log", "event", "info", "warn", "error"] as const;
export type LOG_LEVEL = (typeof LOG_LEVEL)[number];

export const NOTIFICATION_SEVERITY = ["success", "info", "warning", "error"] as const;
export type NOTIFICATION_SEVERITY = (typeof NOTIFICATION_SEVERITY)[number];

/** A coarse-grained type for log/target attribution. */
export const TARGET_TYPE = ["system", "ping", "user", "other"] as const;
export type TARGET_TYPE = (typeof TARGET_TYPE)[number];
