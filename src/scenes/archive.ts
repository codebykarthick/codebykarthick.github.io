import { BoxGeometry, BufferGeometry, Float32BufferAttribute, LineBasicMaterial, MeshBasicMaterial, PlaneGeometry, type Material } from "three";
import { buildingGeometry } from "./kit/buildings";
import { canvasTexture, makeCanvas } from "./kit/canvas";
import { applyAtmosphere, ATMOSPHERES, createKit } from "./kit/index";
import type { Rng, SceneContext, SceneInstance, SceneMeta } from "./types";

/** Knowledge base: an underground archive, an endless cold aisle of server racks. */
export const meta: SceneMeta = {
  id: "archive",
  seed: 9031,
  camera: { fov: 62, narrowFov: 74, near: 0.05, far: 120 },
  bloom: { strength: 0.9, radius: 0.5, threshold: 0.7 },
  settleTime: 3,
};

const AISLE = 1.2; // half-width of the cold aisle
const RACK_W = 0.6;
const RACK_D = 1.1;
const RACK_H = 2.2;
const PERIOD_RACKS = 16;
const PERIOD = PERIOD_RACKS * RACK_W; // the corridor repeats every PERIOD metres
const COPIES = 8;
const CEILING = 3;

const LED_COLORS = [0x3ff0ff, 0x3ff0ff, 0x36e0c8, 0x59ff9c, 0x59ff9c, 0xffb347] as const;

/** Rack front: 1U slots, vents, drive bays. Dim, so the glowing LEDs carry the light. */
function rackTexture(rng: Rng, anisotropy: number) {
  const W = 64, H = 256;
  const { canvas, g } = makeCanvas(W, H);
  g.fillStyle = "#07090d";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#0e1218";
  g.fillRect(3, 0, W - 6, H);
  let y = 6;
  while (y < H - 6) {
    const units = rng.pick([1, 1, 2, 2, 4] as const);
    const h = units * 5.5;
    g.fillStyle = rng.chance(0.15) ? "#05070a" : "#151b23";
    g.fillRect(5, y, W - 10, h - 1);
    if (units >= 2) {
      g.fillStyle = "#0a0d12";
      for (let x = 8; x < W - 14; x += 4) g.fillRect(x, y + 2, 2, h - 5);
    }
    g.fillStyle = "rgba(63,240,255,0.18)";
    g.fillRect(W - 10, y + 1.5, 2, 1);
    y += h;
  }
  const t = canvasTexture(canvas);
  t.anisotropy = anisotropy;
  return t;
}

export function create(ctx: SceneContext): SceneInstance {
  const { camera, pointer, tier, rng } = ctx;
  applyAtmosphere(ctx.scene, ATMOSPHERES.archive);
  const lit = tier === "low" ? 4 : 6;
  const kit = createKit(ctx, { glowCapacity: PERIOD_RACKS * 2 * COPIES * lit + 600, streakCapacity: 200, palettes: [] });
  const { statics, glows, streaks, dark } = kit;
  const length = PERIOD * COPIES;

  const rackMats: Material[] = [0, 1, 2].map(() => new MeshBasicMaterial({ map: rackTexture(rng, ctx.maxAnisotropy) }));
  const stripMat = new MeshBasicMaterial({ color: 0x8fc4d0 });
  const shellMat = new MeshBasicMaterial({ color: 0x040609 });

  // One period of racks, LEDs and lights, then copied along -z so the dolly can loop seamlessly.
  const pattern: Array<{ side: number; i: number; mat: number; gap: boolean }> = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < PERIOD_RACKS; i++) pattern.push({ side, i, mat: Math.floor(rng.next() * rackMats.length), gap: rng.chance(0.06) });
  }
  const leds: Array<{ side: number; i: number; dz: number; y: number; color: number; mode: number; ph: number; rate: number }> = [];
  for (const r of pattern) {
    if (r.gap) continue;
    for (let k = 0; k < lit; k++) {
      leds.push({
        side: r.side,
        i: r.i,
        dz: (rng.next() - 0.5) * RACK_W * 0.7,
        y: 0.15 + rng.next() * (RACK_H - 0.3),
        color: rng.pick(LED_COLORS),
        mode: rng.pick([0, 1, 1, 2] as const), // 0 steady, 1 activity blink, 2 slow pulse
        ph: rng.next() * 100,
        rate: 4 + rng.next() * 18,
      });
    }
  }

  const ledIds: number[][] = leds.map(() => []);
  for (let c = 0; c < COPIES; c++) {
    const z0 = -c * PERIOD;
    for (const r of pattern) {
      const z = z0 - (r.i + 0.5) * RACK_W;
      const x = r.side * (AISLE + RACK_D / 2);
      if (r.gap) {
        const panel = new BoxGeometry(0.08, RACK_H, RACK_W);
        panel.translate(r.side * (AISLE + RACK_D), RACK_H / 2, z);
        statics.add(panel, dark);
        continue;
      }
      statics.add(buildingGeometry(rng, x, z, RACK_D, RACK_W, RACK_H, 0, { tile: [RACK_W, RACK_H], jitter: false }), rackMats[r.mat]!);
    }
    leds.forEach((l, j) => {
      ledIds[j]!.push(glows.add(l.color, l.side * (AISLE - 0.01), l.y, z0 - (l.i + 0.5) * RACK_W + l.dz, 0.11, 0.11, 0.9));
    });
    // Ceiling light strips with floor reflections.
    for (let k = 0; k < 4; k++) {
      const z = z0 - (k + 0.5) * (PERIOD / 4);
      const strip = new BoxGeometry(0.16, 0.04, 1.4);
      strip.translate(0, CEILING - 0.05, z);
      statics.add(strip, stripMat);
      glows.add(0xbfefff, 0, CEILING - 0.12, z, 2.2, 0.7, 0.3);
      streaks.add(0x9fe8ff, 0, z - 0.7, 0.5, 2.4, 0.12);
    }
    // Cold-aisle haze hugging the floor.
    for (let k = 0; k < 3; k++) glows.add(0x2fb8c8, (rng.next() - 0.5) * 1.6, 0.25, z0 - rng.next() * PERIOD, 3.5, 0.9, 0.05);
  }

  // Shell: floor, ceiling, cable trays, end of the corridor lost in fog.
  const floor = new PlaneGeometry(AISLE * 2 + RACK_D * 2, length + 20);
  floor.rotateX(-Math.PI / 2);
  floor.translate(0, 0, -length / 2 + 10);
  statics.add(floor, new MeshBasicMaterial({ color: 0x05090c }));
  const ceiling = new PlaneGeometry(AISLE * 2 + RACK_D * 2, length + 20);
  ceiling.rotateX(Math.PI / 2);
  ceiling.translate(0, CEILING, -length / 2 + 10);
  statics.add(ceiling, shellMat);
  for (const side of [-1, 1]) {
    const tray = new BoxGeometry(0.5, 0.08, length + 20);
    tray.translate(side * (AISLE + 0.45), CEILING - 0.35, -length / 2 + 10);
    statics.add(tray, dark);
    const wall = new PlaneGeometry(length + 20, CEILING - RACK_H);
    wall.rotateY(-side * Math.PI / 2);
    wall.translate(side * (AISLE + RACK_D), RACK_H + (CEILING - RACK_H) / 2, -length / 2 + 10);
    statics.add(wall, shellMat);
  }
  // Raised-floor tile grid.
  const pts: number[] = [];
  for (let z = 10; z > -length - 10; z -= 0.6) pts.push(-AISLE, 0.002, z, AISLE, 0.002, z);
  for (const x of [-AISLE, -0.6, 0, 0.6, AISLE]) pts.push(x, 0.002, 10, x, 0.002, -length - 10);
  const grid = new BufferGeometry();
  grid.setAttribute("position", new Float32BufferAttribute(pts, 3));
  statics.addLines(grid, new LineBasicMaterial({ color: 0x12333d }));
  kit.finish();

  function updateLeds(t: number) {
    leds.forEach((l, j) => {
      let o: number;
      if (l.mode === 0) o = 0.9;
      else if (l.mode === 1) o = Math.sin(t * l.rate + l.ph) + Math.sin(t * l.rate * 1.7 + l.ph * 3) > 0.3 ? 1 : 0.15;
      else o = 0.35 + 0.55 * (0.5 + 0.5 * Math.sin(t * 0.8 + l.ph));
      for (const id of ledIds[j]!) glows.setOpacity(id, o);
    });
  }

  function placeCamera(t: number) {
    const z = -((t * 0.7) % PERIOD);
    camera.position.set(Math.sin(t * 0.21) * 0.08 + pointer.x * 0.25, 1.55 + Math.sin(t * 0.9) * 0.015 - pointer.y * 0.12, z + 1.5);
    camera.lookAt(pointer.x * 0.6, 1.35 - pointer.y * 0.3, z - 12);
  }

  return {
    update(_dt, t) {
      updateLeds(t);
      kit.commit();
      placeCamera(t);
    },
    dispose() {},
  };
}
