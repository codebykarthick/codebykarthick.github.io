import { BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, PlaneGeometry, Points, PointsMaterial } from "three";
import { createBeacons } from "./kit/beacons";
import { canvasTexture, makeCanvas } from "./kit/canvas";
import { skyline, steppedTower } from "./kit/city";
import { applyAtmosphere, ATMOSPHERES, createKit } from "./kit/index";
import type { SceneContext, SceneInstance, SceneMeta } from "./types";

/** About: a desert highway at dusk, solar fields, a lone hauler, the city glowing on the horizon. */
export const meta: SceneMeta = {
  id: "desert",
  seed: 3302,
  camera: { fov: 52, narrowFov: 68, near: 0.3, far: 2600 },
  bloom: { strength: 0.7, radius: 0.55, threshold: 0.9 },
  settleTime: 3,
};

const ROAD = 6;
const FAR = -1500;
const CITY_Z = -1750;

/** Solar panel face: deep blue cells catching the dusk sky towards the top edge. */
function panelTexture() {
  const { canvas, g } = makeCanvas(64, 64);
  const gr = g.createLinearGradient(0, 64, 0, 0);
  gr.addColorStop(0, "#0c0e28");
  gr.addColorStop(0.55, "#3a2a68");
  gr.addColorStop(1, "#ff8a7a");
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  g.strokeStyle = "rgba(5,6,16,0.9)";
  g.lineWidth = 2;
  for (let i = 0; i <= 64; i += 16) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 64);
    g.stroke();
  }
  return canvasTexture(canvas);
}

export function create(ctx: SceneContext): SceneInstance {
  const { camera, pointer, tier, rng, scene } = ctx;
  applyAtmosphere(scene, ATMOSPHERES.desert);
  const kit = createKit(ctx, { glowCapacity: 700, streakCapacity: 80 });
  const { statics, glows, streaks } = kit;
  const beacons = createBeacons(kit);

  const ground = new PlaneGeometry(6000, 4000);
  ground.rotateX(-Math.PI / 2);
  ground.translate(0, 0, -1500);
  statics.add(ground, new MeshBasicMaterial({ color: 0x22101c }));

  // Highway with dashed centre line and roadside reflectors.
  const road = new PlaneGeometry(ROAD * 2, -FAR + 60);
  road.rotateX(-Math.PI / 2);
  road.translate(0, 0.02, FAR / 2 + 30);
  statics.add(road, new MeshBasicMaterial({ color: 0x0a080d }));
  const dashMat = new MeshBasicMaterial({ color: 0x6a5048 });
  for (let z = 20; z > FAR; z -= 12) {
    const dash = new PlaneGeometry(0.2, 4);
    dash.rotateX(-Math.PI / 2);
    dash.translate(0, 0.03, z);
    statics.add(dash, dashMat);
  }
  for (let z = 10; z > FAR; z -= 24) {
    glows.add(0xffb347, -ROAD - 0.5, 0.5, z, 0.7, 0.7, 0.7);
    glows.add(0xff3355, ROAD + 0.5, 0.5, z, 0.7, 0.7, 0.7);
  }

  // Solar fields: tilted rows on both sides, merged into one draw call.
  const panelMat = new MeshBasicMaterial({ map: panelTexture() });
  const rowStep = tier === "low" ? 14 : 9;
  for (const [x0, x1, z0, z1] of [[24, 520, -30, -900], [-420, -30, -260, -820]] as const) {
    for (let z = z0; z > z1; z -= rowStep) {
      const w = x1 - x0;
      const row = new PlaneGeometry(w, 3.2, 1, 1);
      row.rotateX(-Math.PI / 2 + 0.55);
      row.translate((x0 + x1) / 2, 1.6, z);
      statics.add(row, panelMat);
    }
  }

  // Ridge line on the horizon: a strip of quads under a random-walk height profile.
  const heights: number[] = [];
  let h = 30;
  for (let x = -3000; x <= 3000; x += 60) {
    heights.push(h);
    h = Math.max(8, Math.min(110, h + (rng.next() - 0.5) * 40));
  }
  const ridge: number[] = [];
  heights.forEach((h0, i) => {
    const h1 = heights[i + 1];
    if (h1 === undefined) return;
    const x0 = -3000 + i * 60, x1 = x0 + 60;
    ridge.push(x0, 0, -2200, x1, 0, -2200, x0, h0, -2200, x0, h0, -2200, x1, 0, -2200, x1, h1, -2200);
  });
  const ridgeGeo = new BufferGeometry();
  ridgeGeo.setAttribute("position", new Float32BufferAttribute(ridge, 3));
  statics.add(ridgeGeo, new MeshBasicMaterial({ color: 0x2a1030 }));

  // The city on the horizon and its glow.
  skyline(kit, { count: tier === "low" ? 70 : 130, xSpread: 900, zNear: CITY_Z + 80, zFar: CITY_Z - 120, size: [14, 34], height: [20, 160], beacons, beaconAbove: 110 });
  steppedTower(kit, { x: -60, z: CITY_Z - 60, tiers: [[46, 90], [34, 80], [24, 70], [14, 50]], material: kit.windowMaterials[3]!, beacons });
  glows.add(0xff2e88, 0, 40, CITY_Z + 120, 1300, 260, 0.35);
  glows.add(0x3ff0ff, -80, 90, CITY_Z + 100, 700, 160, 0.18);
  glows.add(0xffb347, 120, 20, CITY_Z + 140, 900, 120, 0.2);
  streaks.add(0xff2e88, 0, FAR, 10, -FAR - 40, 0.05);

  // Stars in the darker upper sky.
  const starCount = tier === "low" ? 150 : 380;
  const stars: number[] = [];
  for (let i = 0; i < starCount; i++) {
    const a = (rng.next() - 0.5) * Math.PI * 1.2, e = 0.18 + rng.next() * 0.9, r = 2200;
    stars.push(Math.sin(a) * Math.cos(e) * r, Math.sin(e) * r, -Math.cos(a) * Math.cos(e) * r);
  }
  const starGeo = new BufferGeometry();
  starGeo.setAttribute("position", new Float32BufferAttribute(stars, 3));
  const starPoints = new Points(starGeo, new PointsMaterial({ color: 0xf1ecff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.7, fog: false }));
  scene.add(starPoints);

  // The hauler: tail lights, amber trailer markers and a cab beacon, heading for the city.
  const TRUCK = [
    { dx: -0.9, dy: 1.1, dz: 0, color: 0xff2233, s: 1.2, o: 0.95 },
    { dx: 0.9, dy: 1.1, dz: 0, color: 0xff2233, s: 1.2, o: 0.95 },
    ...[0, 3, 6, 9, 12].flatMap((dz) => [
      { dx: -1.3, dy: 3.6, dz: -dz, color: 0xffb347, s: 0.6, o: 0.8 },
      { dx: 1.3, dy: 3.6, dz: -dz, color: 0xffb347, s: 0.6, o: 0.8 },
    ]),
    { dx: 0, dy: 4.4, dz: -15, color: 0xffd59a, s: 1.4, o: 0.9 },
    { dx: 0, dy: 1, dz: -21, color: 0xfff1d6, s: 7, o: 0.25 },
  ];
  const truck = { z: -40, speed: 18, ids: TRUCK.map((l) => glows.add(l.color, 0, 0, 0, l.s, l.s, l.o)) };
  kit.finish();

  function moveTruck(dt: number) {
    truck.z -= truck.speed * dt;
    if (truck.z < FAR + 100) truck.z = -20;
    TRUCK.forEach((l, i) => glows.setPosition(truck.ids[i]!, -ROAD / 2 + l.dx, l.dy, truck.z + l.dz));
  }

  function placeCamera(t: number) {
    camera.position.set(-ROAD - 3 + Math.sin(t * 0.04) * 1.2 + pointer.x * 2, 2.6 - pointer.y * 0.6, 14);
    camera.lookAt(pointer.x * 40, 22 - pointer.y * 10, -900);
  }

  return {
    update(dt, t) {
      moveTruck(dt);
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
