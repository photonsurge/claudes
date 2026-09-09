/** icomesh ships no types: `icomesh(order, uvMap)` → an icosphere, `uv` per vertex when asked. */
declare module "icomesh" {
  export default function icomesh(
    order?: number,
    uvMap?: boolean,
  ): { vertices: Float32Array; triangles: Uint16Array | Uint32Array; uv?: Float32Array };
}
