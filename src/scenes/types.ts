import type { PerspectiveCamera, Scene, WebGLRenderer } from "three";

export type Tier = "low" | "medium" | "high";
export type SceneMode = "full" | "ambient";
export type SceneId = "home" | "metro" | "archive" | "construction" | "rooftop" | "desert";

export interface Rng {
  next(): number;
  range(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  chance(p: number): boolean;
}

export interface Disposable {
  dispose(): void;
}

export interface SceneContext {
  scene: Scene;
  camera: PerspectiveCamera;
  renderer: WebGLRenderer;
  rng: Rng;
  tier: Tier;
  mode: SceneMode;
  /**
   * Multiplier for sprite glows, shaped as a shader uniform. Below 1 while real
   * bloom is on so the two don't stack; the engine raises it if bloom is dropped.
   */
  glowGain: { value: number };
  /** Smoothed pointer position, -1..1 on both axes. Stays at 0 in ambient mode. */
  pointer: { x: number; y: number };
  /** Narrow viewport (phones). Scenes may widen the camera or thin out detail. */
  narrow: boolean;
  maxAnisotropy: number;
  /** Register something outside the scene graph for disposal. Scene-graph objects are disposed automatically. */
  track<T extends Disposable>(item: T): T;
}

export interface SceneInstance {
  /** dt in seconds (clamped to 0.05), t = seconds since the scene started. */
  update(dt: number, t: number): void;
  /** Optional: put animated lights in a steady state before a still frame (reduced motion, paused at load). */
  still?(): void;
  dispose(): void;
}

export interface SceneMeta {
  id: SceneId;
  seed: number;
  camera: { fov: number; narrowFov: number; near: number; far: number };
  bloom: { strength: number; radius: number; threshold: number };
  /** Seconds of motion before an ambient scene freezes. Also the time used for the reduced-motion still. */
  settleTime: number;
}

export interface SceneModule {
  meta: SceneMeta;
  create(ctx: SceneContext): SceneInstance;
}
