/** Mock for @loaders.gl/core. */
export async function load() {
  return { width: 1, height: 1, data: new Uint8Array(4) };
}
export const ImageLoader = {};
