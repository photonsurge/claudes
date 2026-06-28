/** Minimal maplibre-gl mock for jsdom tests (no WebGL). */
export class Map {
  constructor(public opts: Record<string, unknown> = {}) {}
  on() {
    return this;
  }
  once() {
    return this;
  }
  off() {
    return this;
  }
  remove() {}
  setProjection() {}
  setStyle() {}
  addControl() {}
  flyTo() {}
  fitBounds() {}
  getCenter() {
    return { lng: 0, lat: 0 };
  }
  getZoom() {
    return 1;
  }
}
export class NavigationControl {}
export class AttributionControl {}
const maplibregl = { Map, NavigationControl, AttributionControl };
export default maplibregl;
