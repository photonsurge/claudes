/** Mock for weatherlayers-gl. Layers capture props for assertions. */
class BaseLayer {
  props: Record<string, unknown>;
  constructor(props: Record<string, unknown> = {}) {
    this.props = props;
  }
}
export class RasterLayer extends BaseLayer {}
export class ParticleLayer extends BaseLayer {}
export class ContourLayer extends BaseLayer {}
export class HighLowLayer extends BaseLayer {}
