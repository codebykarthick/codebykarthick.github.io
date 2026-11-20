import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from "three";
import type { Kit } from "./index";

export interface RainOptions {
  count: number;
  width: number;
  height: number;
  zMin: number;
  zMax: number;
  color?: number;
  opacity?: number;
  /** Streak vector per drop (slant and length). */
  slant?: [number, number];
}

export interface RainSystem {
  update(dt: number): void;
}

/** Line-segment rain in a box around the camera. */
export function createRain(kit: Kit, opts: RainOptions): RainSystem {
  const { rng } = kit;
  const n = opts.count;
  const [sx, sy] = opts.slant ?? [0.12, 0.9];
  const pos = new Float32Array(n * 6);
  const vel = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (rng.next() - 0.5) * opts.width, y = rng.next() * opts.height, z = rng.range(opts.zMin, opts.zMax);
    pos.set([x, y, z, x + sx, y + sy, z], i * 6);
    vel[i] = 28 + rng.next() * 14;
  }
  const geo = new BufferGeometry();
  const attr = new BufferAttribute(pos, 3);
  geo.setAttribute("position", attr);
  const lines = new LineSegments(
    geo,
    new LineBasicMaterial({ color: opts.color ?? 0x8f9ccc, transparent: true, opacity: opts.opacity ?? 0.3, depthWrite: false }),
  );
  lines.frustumCulled = false;
  kit.ctx.scene.add(lines);
  return {
    update(dt) {
      for (let i = 0; i < n; i++) {
        const o = i * 6;
        let y = pos[o + 1]! - vel[i]! * dt;
        if (y < 0) y += opts.height;
        pos[o + 1] = y;
        pos[o + 4] = y + sy;
      }
      attr.needsUpdate = true;
    },
  };
}
