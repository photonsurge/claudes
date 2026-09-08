/** jest stand-in for subglobe-worker-client: no Worker under jsdom, so the
 *  widget paints on the main thread (which is what its tests exercise). The
 *  real module uses `import.meta.url`, which the CommonJS test build can't parse. */
export function createSubGlobeWorker(): Worker | null {
  return null;
}
