/** Mock for @deck.gl/geo-layers — captures props for assertions. */
export class TileLayer {
  props: Record<string, unknown>;
  constructor(props: Record<string, unknown> = {}) {
    this.props = props;
  }
}

/** Stand-in for the tileset class `tile-obb-patch` wraps to reach deck's
 *  private OSMNode. Returns no tiles, so nothing is patched through it here. */
export class _Tileset2D {
  getTileIndices(): unknown[] {
    return [];
  }
}
