import type { Kit } from "./index";

/** Blinking aircraft-warning lights on tall roofs. */
export interface BeaconSystem {
  add(x: number, y: number, z: number, size?: number, color?: number): void;
  update(t: number): void;
  /** All beacons fully lit (reduced-motion still). */
  steady(): void;
}

export function createBeacons(kit: Kit): BeaconSystem {
  const list: Array<{ i: number; ph: number; rate: number }> = [];
  return {
    add(x, y, z, size = 3, color = 0xff2244) {
      const i = kit.glows.add(color, x, y, z, size, size, 0.9);
      list.push({ i, ph: kit.rng.next() * 6.28, rate: 1.2 + kit.rng.next() * 1.2 });
    },
    update(t) {
      for (const b of list) kit.glows.setOpacity(b.i, Math.sin(t * b.rate + b.ph) > 0.2 ? 0.9 : 0.12);
    },
    steady() {
      for (const b of list) kit.glows.setOpacity(b.i, 0.9);
    },
  };
}
