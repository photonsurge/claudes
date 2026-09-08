/** jest stub for lib/texture-decode-client (the real one uses import.meta.url):
 *  no worker → textures.ts takes the WeatherLayers main-thread loader path. */
export type TextureDecoder = (url: string) => Promise<unknown>;
export function createTextureDecoder(): TextureDecoder | null {
  return null;
}
