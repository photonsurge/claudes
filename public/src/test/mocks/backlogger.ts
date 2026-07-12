/**
 * Mock for @photonsurge/shared/utill/BackLogger.
 *
 * The real module pulls in mongoose (→ mongodb → bson.mjs, an untransformed
 * ESM file jest can't parse), so importing it — even transitively, e.g. via
 * lib/api-log from lib/focus/focus-cache — would blow up an otherwise
 * pure-logic test suite. Logging is a fire-and-forget side effect with no
 * assertions on it, so we stub it to a no-op (same pattern as the GL mocks).
 */
export const PublicBackLogger = async (): Promise<void> => {};
