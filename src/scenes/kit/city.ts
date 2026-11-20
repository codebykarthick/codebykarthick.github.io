import { CylinderGeometry, LineBasicMaterial, MeshBasicMaterial, PlaneGeometry, BoxGeometry, type Material } from "three";
import type { BeaconSystem } from "./beacons";
import { boxEdges, buildingGeometry, type Frontage } from "./buildings";
import type { Kit } from "./index";
import { BOARD_WORDS, SIGN_COLORS, SIGN_WORDS, type SignSystem } from "./signs";

export interface AvenueOptions {
  /** Half-width of the road. */
  road: number;
  zNear: number;
  zFar: number;
  maxX: number;
  beacons?: BeaconSystem;
}

/** Two rows of buildings lining a straight road along -z. Returns the street-facing frontages. */
export function avenue(kit: Kit, o: AvenueOptions): Frontage[] {
  const { rng, statics, windowMaterials } = kit;
  const fronts: Frontage[] = [];
  const depth = o.zNear - o.zFar;
  for (const side of [-1, 1] as const) {
    let z = o.zNear;
    while (z > o.zFar) {
      const d = 7 + rng.next() * 12;
      const zc = z - d / 2;
      let x = o.road + 0.5 + rng.next() * 1.2;
      let col = 0;
      while (x < o.maxX) {
        const w = 7 + rng.next() * 10;
        const far = Math.max(0, -zc) / depth;
        let h = 10 + Math.pow(rng.next(), 2) * 55 + far * rng.next() * 60;
        if (rng.chance(0.06)) h += 60 + rng.next() * 60;
        const mat = rng.pick(windowMaterials);
        statics.add(buildingGeometry(rng, side * (x + w / 2), zc, w, d, h), mat);
        if (col === 0) fronts.push({ side, x, w, zc, d, h });
        if (o.beacons && h > 55 && rng.chance(0.6)) o.beacons.add(side * (x + w / 2), h + 0.6, zc);
        x += w + 1 + rng.next() * 3;
        col++;
      }
      z -= d + 1.5 + rng.next() * 3.5;
    }
  }
  return fronts;
}

export interface SkylineOptions {
  count: number;
  xSpread: number;
  zNear: number;
  zFar: number;
  size?: [number, number];
  height?: [number, number];
  beacons?: BeaconSystem;
  beaconAbove?: number;
}

/** Distant blocks filling the horizon. */
export function skyline(kit: Kit, o: SkylineOptions): void {
  const { rng, statics, windowMaterials } = kit;
  const [s0, s1] = o.size ?? [14, 40];
  const [h0, h1] = o.height ?? [40, 230];
  for (let i = 0; i < o.count; i++) {
    const w = rng.range(s0, s1), d = rng.range(s0, s1), h = h0 + Math.pow(rng.next(), 1.6) * (h1 - h0);
    const x = (rng.next() - 0.5) * o.xSpread, z = rng.range(o.zNear, o.zFar);
    const mat = rng.pick(windowMaterials);
    statics.add(buildingGeometry(rng, x, z, w, d, h), mat);
    if (o.beacons && h > (o.beaconAbove ?? 120) && rng.chance(0.7)) o.beacons.add(x, h + 1, z);
  }
}

export interface TowerOptions {
  x: number;
  z: number;
  /** [width, height] per tier, bottom up. */
  tiers: ReadonlyArray<readonly [number, number]>;
  material: Material;
  edgeColor?: number;
  edgeOpacity?: number;
  /** Fraction of the total height that is built (construction scene). */
  built?: number;
  spire?: boolean;
  beacons?: BeaconSystem;
}

/** Stepped megatower with neon edge lines. Returns the top of the built part. */
export function steppedTower(kit: Kit, o: TowerOptions): number {
  const { rng, statics } = kit;
  const total = o.tiers.reduce((s, [, h]) => s + h, 0);
  const limit = total * (o.built ?? 1);
  const edgeMat = new LineBasicMaterial({ color: o.edgeColor ?? 0x3ff0ff, transparent: true, opacity: o.edgeOpacity ?? 0.5 });
  let y = 0;
  for (const [s, h0] of o.tiers) {
    if (y >= limit) break;
    const h = Math.min(h0, limit - y);
    statics.add(buildingGeometry(rng, o.x, o.z, s, s, h, y), o.material);
    statics.addLines(boxEdges(o.x, y + h / 2, o.z, s, h, s), edgeMat);
    y += h;
  }
  if ((o.spire ?? true) && y >= total) {
    const spire = new CylinderGeometry(0.4, 1.8, 44, 8);
    spire.translate(o.x, y + 22, o.z);
    statics.add(spire, kit.dark);
    o.beacons?.add(o.x, y + 45, o.z, 8);
  }
  return y;
}

/** Ground plane, road surface and centre dashes. */
export function streetSurface(kit: Kit, o: { road: number; zNear: number; zFar: number }): void {
  const { statics } = kit;
  const ground = new PlaneGeometry(1400, 1400);
  ground.rotateX(-Math.PI / 2);
  ground.translate(0, 0, -300);
  statics.add(ground, new MeshBasicMaterial({ color: 0x06050b }));
  const len = o.zNear - o.zFar + 20;
  const road = new PlaneGeometry(o.road * 2, len);
  road.rotateX(-Math.PI / 2);
  road.translate(0, 0.01, o.zNear - len / 2 + 4);
  statics.add(road, new MeshBasicMaterial({ color: 0x0c0a14 }));
  const dashMat = new MeshBasicMaterial({ color: 0x4b3d6e });
  for (let z = o.zNear + 2; z > o.zFar; z -= 7) {
    const dash = new PlaneGeometry(0.18, 2.4);
    dash.rotateX(-Math.PI / 2);
    dash.translate(0, 0.02, z);
    statics.add(dash, dashMat);
  }
}

/** Sodium street lamps on both kerbs, with wet-road reflections. */
export function streetLamps(kit: Kit, o: { road: number; zNear: number; zFar: number; spacing?: number; color?: number }): void {
  const { statics, glows, streaks, dark } = kit;
  const color = o.color ?? 0xffb347;
  for (let z = o.zNear; z > o.zFar; z -= o.spacing ?? 16) {
    for (const side of [-1, 1]) {
      const x = side * (o.road - 0.6);
      const pole = new BoxGeometry(0.18, 7, 0.18);
      pole.translate(x, 3.5, z);
      statics.add(pole, dark);
      const arm = new BoxGeometry(1.6, 0.14, 0.14);
      arm.translate(x - side * 0.7, 7, z);
      statics.add(arm, dark);
      glows.add(color, x - side * 1.4, 6.9, z, 3.2, 3.2, 0.75);
      streaks.add(color, x - side * 1.4, z, 1.6, 10, 0.16);
    }
  }
}

/** Blade signs on near frontages and the odd rooftop billboard further away. */
export function hangSigns(kit: Kit, signs: SignSystem, fronts: readonly Frontage[], o: { max: number; nearZ?: number }): void {
  const { rng } = kit;
  const nearZ = o.nearZ ?? -200;
  for (const f of fronts) {
    if (signs.count() >= o.max) break;
    const n = f.zc > nearZ ? (rng.chance(0.85) ? 1 + Math.floor(rng.next() * 2) : 0) : rng.chance(0.5) ? 1 : 0;
    for (let i = 0; i < n; i++) {
      const color = rng.pick(SIGN_COLORS);
      const word = rng.pick(SIGN_WORDS);
      const w = 1.5, h = signs.bladeHeight(word, w);
      const y = Math.min(f.h - h / 2 - 1, 4 + h / 2 + rng.next() * Math.max(2, Math.min(24, f.h - h - 6)));
      if (y < h / 2 + 3) continue;
      const z = f.zc + (rng.next() - 0.5) * Math.max(0, f.d - 2);
      signs.blade(word, color, f.side * (f.x - 0.9), y, z, w, true);
    }
    if (f.h < 45 && f.zc < -20 && rng.chance(0.35)) {
      const color = rng.pick(SIGN_COLORS);
      signs.board(rng.pick(BOARD_WORDS), color, f.side * (f.x + f.w / 2), f.h + 3, f.zc, 10, 3.9);
    }
  }
}
