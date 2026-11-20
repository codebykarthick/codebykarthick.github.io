import type { Kit } from "./index";

/** Vehicles as light pairs travelling along z and wrapping between zMin and zMax. */
export interface TrafficOptions {
  zMin: number;
  zMax: number;
  /** Flying lanes: altitude and lateral spread. */
  air: { count: number; lanes: readonly number[]; spread: (y: number) => number; speed: [number, number] };
  /** Ground lanes at ±x. */
  ground?: { count: number; x: number; y: number; speed: [number, number] };
  colors?: { head: number; tail: number; headTrail: number; tailTrail: number };
}

export interface TrafficSystem {
  update(dt: number): void;
}

const DEFAULT_COLORS = { head: 0xfff1d6, tail: 0xff3355, headTrail: 0x9fdcff, tailTrail: 0xff2e88 };

export function createTraffic(kit: Kit, opts: TrafficOptions): TrafficSystem {
  const { rng, glows } = kit;
  const colors = opts.colors ?? DEFAULT_COLORS;
  const cars: Array<{ lights: number; trail: number; dir: number; speed: number; x: number; y: number; z: number }> = [];

  function add(x: number, y: number, dir: number, speed: number) {
    const toward = dir > 0;
    const z = opts.zMin + rng.next() * (opts.zMax - opts.zMin);
    const lights = glows.add(toward ? colors.head : colors.tail, x, y, z, toward ? 2.0 : 1.5, toward ? 0.9 : 0.7, 0.95);
    const trail = y > 3 ? glows.add(toward ? colors.headTrail : colors.tailTrail, x, y, z - dir * 1.6, 1, 0.4, 0.3) : -1;
    cars.push({ lights, trail, dir, speed, x, y, z });
  }

  for (let i = 0; i < opts.air.count; i++) {
    const y = rng.pick(opts.air.lanes);
    add((rng.next() - 0.5) * opts.air.spread(y), y, rng.chance(0.5) ? 1 : -1, rng.range(...opts.air.speed));
  }
  if (opts.ground) {
    for (let i = 0; i < opts.ground.count; i++) {
      const dir = rng.chance(0.5) ? 1 : -1;
      add(dir > 0 ? -opts.ground.x : opts.ground.x, opts.ground.y, dir, rng.range(...opts.ground.speed));
    }
  }

  return {
    update(dt) {
      for (const c of cars) {
        c.z += c.dir * c.speed * dt;
        if (c.z > opts.zMax) c.z = opts.zMin;
        else if (c.z < opts.zMin) c.z = opts.zMax;
        glows.setPosition(c.lights, c.x, c.y, c.z);
        glows.setPosition(c.trail, c.x, c.y, c.z - c.dir * 1.6);
      }
    },
  };
}
