import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  Mesh,
  MeshBasicMaterial,
  type ColorRepresentation,
  type Texture,
} from "three";

/**
 * Wet-street reflections: ground-aligned quads that start at a light source and
 * fade towards the viewer. One mesh for all of them; opacity is per streak.
 */
export class StreakField {
  readonly mesh: Mesh<BufferGeometry, MeshBasicMaterial>;
  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly colorAttr: BufferAttribute;
  private count = 0;
  private dirty = false;

  constructor(map: Texture, private readonly capacity: number, private readonly gain: { value: number }, private readonly y = 0.03) {
    this.positions = new Float32Array(capacity * 4 * 3);
    this.colors = new Float32Array(capacity * 4 * 4);
    const uvs = new Float32Array(capacity * 4 * 2);
    const index = new Uint32Array(capacity * 6);
    for (let i = 0; i < capacity; i++) {
      uvs.set([0, 1, 1, 1, 0, 0, 1, 0], i * 8);
      const v = i * 4;
      index.set([v, v + 2, v + 1, v + 1, v + 2, v + 3], i * 6);
    }
    const geo = new BufferGeometry();
    geo.setAttribute("position", new BufferAttribute(this.positions, 3));
    geo.setAttribute("uv", new BufferAttribute(uvs, 2));
    this.colorAttr = new BufferAttribute(this.colors, 4);
    geo.setAttribute("color", this.colorAttr);
    geo.setIndex(new BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    const material = new MeshBasicMaterial({
      map,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  /** A streak from (x, z) running len units towards +z (the viewer). */
  add(color: ColorRepresentation, x: number, z: number, w: number, len: number, opacity: number): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    const x0 = x - w / 2, x1 = x + w / 2, y = this.y;
    this.positions.set([x0, y, z, x1, y, z, x0, y, z + len, x1, y, z + len], i * 12);
    const c = new Color(color);
    for (let k = 0; k < 4; k++) this.colors.set([c.r, c.g, c.b, opacity], i * 16 + k * 4);
    this.mesh.geometry.getAttribute("position").needsUpdate = true;
    this.mesh.geometry.setDrawRange(0, this.count * 6);
    this.dirty = true;
    return i;
  }

  setOpacity(i: number, opacity: number): void {
    if (i < 0) return;
    const o = i * 16 + 3;
    if (this.colors[o] === opacity) return;
    for (let k = 0; k < 4; k++) this.colors[o + k * 4] = opacity;
    this.dirty = true;
  }

  commit(): void {
    this.mesh.material.color.setScalar(this.gain.value);
    if (this.dirty) this.colorAttr.needsUpdate = true;
    this.dirty = false;
  }
}
