import { AdditiveBlending, CylinderGeometry, DoubleSide, Mesh, MeshBasicMaterial } from "three";
import type { Kit } from "./index";

export interface SearchlightSystem {
  add(x: number, z: number, color: number, opts?: { length?: number; radius?: number; tilt?: number; y?: number; opacity?: number }): void;
  update(t: number): void;
}

/** Sweeping additive light cones. */
export function createSearchlights(kit: Kit): SearchlightSystem {
  const beams: Array<{ b: Mesh; ph: number; rate: number }> = [];
  return {
    add(x, z, color, o = {}) {
      const len = o.length ?? 170;
      const geo = new CylinderGeometry(0.6, o.radius ?? 9, len, 24, 1, true);
      geo.translate(0, len / 2, 0);
      const m = new MeshBasicMaterial({
        color,
        transparent: true,
        opacity: (o.opacity ?? 0.06) * kit.ctx.glowGain.value,
        blending: AdditiveBlending,
        depthWrite: false,
        side: DoubleSide,
        forceSinglePass: true,
      });
      const b = new Mesh(geo, m);
      b.position.set(x, o.y ?? 0, z);
      b.rotation.x = o.tilt ?? -0.18;
      kit.ctx.scene.add(b);
      beams.push({ b, ph: kit.rng.next() * 6.28, rate: 0.12 + kit.rng.next() * 0.1 });
    },
    update(t) {
      for (const s of beams) s.b.rotation.z = Math.sin(t * s.rate + s.ph) * 0.45;
    },
  };
}
