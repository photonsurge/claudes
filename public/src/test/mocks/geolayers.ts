/** Mock for @deck.gl/geo-layers — captures props for assertions. */
export class TileLayer {
  props: Record<string, unknown>;
  constructor(props: Record<string, unknown> = {}) {
    this.props = props;
  }
}
