import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  RepeatWrapping,
} from "three";
import { createBeacons } from "./kit/beacons";
import { buildingGeometry } from "./kit/buildings";
import { canvasTexture, makeCanvas } from "./kit/canvas";
import { applyAtmosphere, ATMOSPHERES, createKit } from "./kit/index";
import { createSearchlights } from "./kit/searchlights";
import type { Rng, SceneContext, SceneInstance, SceneMeta } from "./types";

/** Ideas: on a rooftop looking up. Antenna forest, drifting drones, searchlights in low cloud. */
export const meta: SceneMeta = {
  id: "rooftop",
  seed: 5560,
  camera: { fov: 60, narrowFov: 76, near: 0.3, far: 1600 },
  bloom: { strength: 0.75, radius: 0.5, threshold: 0.82 },
  settleTime: 3,
};

const STREET = -140;

/** Soft tileable cloud: overlapping radial blobs drawn with wraparound. */
function cloudTexture(rng: Rng) {
  const S = 512;
  const { canvas, g } = makeCanvas(S, S);
  g.clearRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const x = rng.next() * S, y = rng.next() * S, r = 40 + rng.next() * 120, a = 0.05 + rng.next() * 0.12;
    for (const ox of [-S, 0, S]) {
      for (const oy of [-S, 0, S]) {
        const gr = g.createRadialGradient(x + ox, y + oy, 0, x + ox, y + oy, r);
        gr.addColorStop(0, `rgba(255,255,255,${a})`);
        gr.addColorStop(1, "rgba(255,255,255,0)");
        g.fillStyle = gr;
        g.fillRect(x + ox - r, y + oy - r, r * 2, r * 2);
      }
    }
  }
  const t = canvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  return t;
}

export function create(ctx: SceneContext): SceneInstance {
  const { camera, pointer, tier, rng, scene } = ctx;
  applyAtmosphere(scene, ATMOSPHERES.rooftop);
  const kit = createKit(ctx, { glowCapacity: 400, streakCapacity: 10 });
  const { statics, glows, dark } = kit;
  const beacons = createBeacons(kit);
  const silhouette = new MeshBasicMaterial({ color: 0x05030a });

  // Our roof: deck, parapet, plant boxes.
  const deck = new PlaneGeometry(70, 60);
  deck.rotateX(-Math.PI / 2);
  deck.translate(0, 0, -20);
  statics.add(deck, new MeshBasicMaterial({ color: 0x0b0812 }));
  for (const [x, z, w, d] of [[0, -50, 70, 0.6], [-35, -20, 0.6, 60], [35, -20, 0.6, 60]] as const) {
    const wall = new BoxGeometry(w, 1.2, d);
    wall.translate(x, 0.6, z);
    statics.add(wall, silhouette);
  }
  for (let i = 0; i < 4; i++) {
    const box = new BoxGeometry(3 + rng.next() * 4, 1.5 + rng.next() * 2, 3 + rng.next() * 3);
    box.translate((rng.next() - 0.5) * 50, 1, -8 - rng.next() * 30);
    statics.add(box, dark);
  }

  // Antenna forest: masts, crossbars, dishes and guy wires, all silhouettes against the cloud.
  const wires: number[] = [];
  const masts = tier === "low" ? 16 : 28;
  for (let i = 0; i < masts; i++) {
    const x = (rng.next() - 0.5) * 60, z = -6 - rng.next() * 40, h = 6 + Math.pow(rng.next(), 1.5) * 34;
    const r = 0.08 + rng.next() * 0.14;
    const mast = new CylinderGeometry(r * 0.6, r, h, 5);
    mast.translate(x, h / 2, z);
    statics.add(mast, silhouette);
    const bars = Math.floor(rng.next() * 4);
    for (let b = 0; b < bars; b++) {
      const bar = new BoxGeometry(1.5 + rng.next() * 3, 0.08, 0.08);
      bar.rotateY(rng.next() * Math.PI);
      bar.translate(x, h * (0.5 + rng.next() * 0.45), z);
      statics.add(bar, silhouette);
    }
    if (rng.chance(0.3)) {
      const dish = new CylinderGeometry(1.4, 0.2, 0.6, 12, 1, true);
      dish.rotateX(Math.PI / 2 - 0.5);
      dish.rotateY(rng.next() * Math.PI * 2);
      dish.translate(x, h * (0.4 + rng.next() * 0.4), z);
      statics.add(dish, silhouette);
    }
    if (h > 18) {
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * Math.PI * 2 + rng.next();
        wires.push(x, h * 0.85, z, x + Math.cos(a) * h * 0.4, 0.1, z + Math.sin(a) * h * 0.4);
      }
    }
    beacons.add(x, h + 0.3, z, 1.1);
  }
  const wireGeo = new BufferGeometry();
  wireGeo.setAttribute("position", new Float32BufferAttribute(wires, 3));
  statics.addLines(wireGeo, new LineBasicMaterial({ color: 0x1a1024, transparent: true, opacity: 0.8 }));

  // Neighbouring towers rising from the street far below.
  const towers = tier === "low" ? 60 : 110;
  for (let i = 0; i < towers; i++) {
    const a = -Math.PI * 0.1 - rng.next() * Math.PI * 0.8, d = 60 + Math.pow(rng.next(), 0.7) * 380;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const w = 12 + rng.next() * 24, h = 140 + rng.next() * 60 + Math.pow(rng.next(), 2) * 260;
    statics.add(buildingGeometry(rng, x, z, w, w, h, STREET), rng.pick(kit.windowMaterials));
    if (h > 260) beacons.add(x, STREET + h + 1, z, 4);
  }

  // Low cloud: two scrolling layers, lit pink from the street.
  const clouds = [
    { y: 150, color: 0xc06ad8, opacity: 0.5, speed: [0.004, 0.0015] as const, repeat: 3 },
    { y: 190, color: 0xff7ac0, opacity: 0.32, speed: [-0.0025, 0.003] as const, repeat: 2 },
  ].map((c) => {
    const map = cloudTexture(rng);
    map.repeat.set(c.repeat, c.repeat);
    const plane = new Mesh(
      new PlaneGeometry(2400, 2400),
      new MeshBasicMaterial({ map, color: c.color, transparent: true, opacity: c.opacity, depthWrite: false, blending: AdditiveBlending }),
    );
    plane.rotation.x = Math.PI / 2;
    plane.position.set(0, c.y, -300);
    scene.add(plane);
    return { map, speed: c.speed };
  });

  const lights = createSearchlights(kit);
  for (const [x, z, color] of [[-120, -260, 0x3ff0ff], [90, -320, 0x7fe8ff], [10, -420, 0xb9a6ff], [-40, -180, 0x3ff0ff]] as const) {
    lights.add(x, z, color, { y: STREET, length: 420, radius: 16, tilt: 0.05 + rng.next() * 0.15, opacity: 0.07 });
  }

  // Drones: white body light, red and green navigation lights, slow Lissajous drift.
  const drones = Array.from({ length: tier === "low" ? 8 : 14 }, () => {
    const d = {
      cx: (rng.next() - 0.5) * 140,
      cy: 25 + rng.next() * 90,
      cz: -30 - rng.next() * 160,
      ax: 10 + rng.next() * 30,
      az: 8 + rng.next() * 20,
      w: 0.03 + rng.next() * 0.05,
      ph: rng.next() * 10,
      body: glows.add(0xe9eeff, 0, 0, 0, 1.6, 1.6, 0.85),
      red: glows.add(0xff2244, 0, 0, 0, 1, 1, 0.9),
      green: glows.add(0x59ff9c, 0, 0, 0, 1, 1, 0.9),
    };
    return d;
  });
  kit.finish();

  function updateDrones(t: number) {
    for (const d of drones) {
      const x = d.cx + Math.sin(t * d.w + d.ph) * d.ax;
      const z = d.cz + Math.sin(t * d.w * 1.3 + d.ph * 2) * d.az;
      const y = d.cy + Math.sin(t * d.w * 2 + d.ph) * 3;
      glows.setPosition(d.body, x, y, z);
      glows.setPosition(d.red, x - 1.2, y, z);
      glows.setPosition(d.green, x + 1.2, y, z);
      const blink = Math.sin(t * 3 + d.ph) > 0.6 ? 0.95 : 0.2;
      glows.setOpacity(d.red, blink);
      glows.setOpacity(d.green, blink);
    }
  }

  function placeCamera(t: number) {
    camera.position.set(Math.sin(t * 0.05) * 1.5 + pointer.x * 1.5, 2 - pointer.y * 0.5, 4);
    camera.lookAt(Math.sin(t * 0.03) * 12 + pointer.x * 20, 46 - pointer.y * 12, -70);
  }

  return {
    update(_dt, t) {
      for (const c of clouds) c.map.offset.set(t * c.speed[0], t * c.speed[1]);
      updateDrones(t);
      lights.update(t);
      beacons.update(t);
      kit.commit();
      placeCamera(t);
    },
    still() {
      beacons.steady();
      kit.commit();
    },
    dispose() {},
  };
}
