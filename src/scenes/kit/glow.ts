import {
  AdditiveBlending,
  Color,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  type ColorRepresentation,
  type Texture,
} from "three";

const vertexShader = /* glsl */ `
attribute vec3 offset;
attribute vec2 scale;
attribute vec4 tint;
varying vec2 vUv;
varying vec4 vTint;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vTint = tint;
  vec4 mvPosition = modelViewMatrix * vec4(offset, 1.0);
  mvPosition.xy += position.xy * scale;
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}
`;

const fragmentShader = /* glsl */ `
uniform sampler2D map;
uniform float gain;
varying vec2 vUv;
varying vec4 vTint;
#include <common>
#include <fog_pars_fragment>
void main() {
  float a = texture2D(map, vUv).a;
  // Matches SpriteMaterial fog under additive blending: mix(colour, fogColour, f) * alpha * opacity.
  vec3 c = vTint.rgb;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    c = mix(c, fogColor * vTint.a, fogFactor);
  #endif
  gl_FragColor = vec4(c * a * gain, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Camera-facing additive glows drawn as one instanced mesh: the PoC's glow
 * sprites without one draw call each. Static and animated glows both live here;
 * call setOpacity / setPosition per frame, then commit().
 */
export class GlowField {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly offsets: Float32Array;
  private readonly scales: Float32Array;
  private readonly tints: Float32Array;
  private readonly base: Float32Array;
  private readonly opacity: Float32Array;
  private readonly offsetAttr: InstancedBufferAttribute;
  private readonly tintAttr: InstancedBufferAttribute;
  private count = 0;
  private dirtyOffsets = false;
  private dirtyTints = false;

  constructor(map: Texture, private readonly capacity: number, gain: { value: number }) {
    const plane = new PlaneGeometry(1, 1);
    const geo = new InstancedBufferGeometry();
    geo.index = plane.index;
    geo.setAttribute("position", plane.getAttribute("position"));
    geo.setAttribute("uv", plane.getAttribute("uv"));
    this.offsets = new Float32Array(capacity * 3);
    this.scales = new Float32Array(capacity * 2);
    this.tints = new Float32Array(capacity * 4);
    this.base = new Float32Array(capacity * 3);
    this.opacity = new Float32Array(capacity);
    this.offsetAttr = new InstancedBufferAttribute(this.offsets, 3);
    this.tintAttr = new InstancedBufferAttribute(this.tints, 4);
    geo.setAttribute("offset", this.offsetAttr);
    geo.setAttribute("scale", new InstancedBufferAttribute(this.scales, 2));
    geo.setAttribute("tint", this.tintAttr);
    geo.instanceCount = 0;
    const material = new ShaderMaterial({
      uniforms: { ...UniformsUtils.clone(UniformsLib.fog), map: { value: map }, gain },
      vertexShader,
      fragmentShader,
      fog: true,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  /** Returns the glow's index, or -1 if the field is full. */
  add(color: ColorRepresentation, x: number, y: number, z: number, sx: number, sy: number, opacity: number): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    const c = new Color(color);
    this.base.set([c.r, c.g, c.b], i * 3);
    this.offsets.set([x, y, z], i * 3);
    this.scales.set([sx, sy], i * 2);
    this.opacity[i] = Number.NaN;
    this.setOpacity(i, opacity);
    this.mesh.geometry.instanceCount = this.count;
    this.dirtyOffsets = true;
    this.mesh.geometry.getAttribute("scale").needsUpdate = true;
    return i;
  }

  setOpacity(i: number, opacity: number): void {
    if (i < 0 || this.opacity[i] === opacity) return;
    this.opacity[i] = opacity;
    const b = i * 3, o = i * 4;
    this.tints[o] = this.base[b]! * opacity;
    this.tints[o + 1] = this.base[b + 1]! * opacity;
    this.tints[o + 2] = this.base[b + 2]! * opacity;
    this.tints[o + 3] = opacity;
    this.dirtyTints = true;
  }

  setPosition(i: number, x: number, y: number, z: number): void {
    if (i < 0) return;
    const o = i * 3;
    this.offsets[o] = x;
    this.offsets[o + 1] = y;
    this.offsets[o + 2] = z;
    this.dirtyOffsets = true;
  }

  getZ(i: number): number {
    return this.offsets[i * 3 + 2]!;
  }

  commit(): void {
    if (this.dirtyOffsets) this.offsetAttr.needsUpdate = true;
    if (this.dirtyTints) this.tintAttr.needsUpdate = true;
    this.dirtyOffsets = this.dirtyTints = false;
  }
}
