/** Mock for @deck.gl/core, @deck.gl/layers and @deck.gl/mapbox.
 * Layers just capture their props so prop-builders can be asserted on. */
export class BaseLayer {
  props: Record<string, unknown>;
  constructor(props: Record<string, unknown> = {}) {
    this.props = props;
  }
}
export class ScatterplotLayer extends BaseLayer {}
export class TextLayer extends BaseLayer {}
export class BitmapLayer extends BaseLayer {}
export class GeoJsonLayer extends BaseLayer {}
export class SolidPolygonLayer extends BaseLayer {}
export class IconLayer extends BaseLayer {}
export class _GlobeView extends BaseLayer {}
export class LinearInterpolator extends BaseLayer {}
export class Deck extends BaseLayer {
  setProps() {}
  finalize() {}
}
export class MapboxOverlay {
  props: Record<string, unknown>;
  constructor(props: Record<string, unknown> = {}) {
    this.props = props;
  }
  setProps(props: Record<string, unknown>) {
    this.props = { ...this.props, ...props };
  }
  onAdd() {
    return document.createElement("div");
  }
  onRemove() {}
  finalize() {}
}
