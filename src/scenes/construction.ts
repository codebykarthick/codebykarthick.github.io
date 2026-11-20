import { BoxGeometry, BufferGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh, MeshBasicMaterial, PlaneGeometry } from "three";
import { createBeacons } from "./kit/beacons";
import { boxEdges } from "./kit/buildings";
import { skyline, steppedTower } from "./kit/city";
import { applyAtmosphere, ATMOSPHERES, createKit } from "./kit/index";
import type { SceneContext, SceneInstance, SceneMeta } from "./types";

/** Projects: a construction district at night, cranes assembling a half-built megatower. */
export const meta: SceneMeta = {
  id: "construction",
  seed: 7781,
  camera: { fov: 55, narrowFov: 70, near: 0.5, far: 1500 },
  bloom: { strength: 0.85, radius: 0.5, threshold: 0.8 },
  settleTime: 3,
};

const TOWER = { x: 0, z: -170 };
const TIERS: ReadonlyArray<readonly [number, number]> = [[64, 80], [50, 70], [36, 60], [24, 50]];
const BUILT = 0.56;

export function create(ctx: SceneContext): SceneInstance {
  const { camera, pointer, tier, rng, scene } = ctx;
  applyAtmosphere(scene, ATMOSPHERES.construction);
  const kit = createKit(ctx, { glowCapacity: 1400, streakCapacity: 120 });
  const { statics, glows, streaks, dark } = kit;
  const beacons = createBeacons(kit);

  const ground = new PlaneGeometry(3000, 3000);
  ground.rotateX(-Math.PI / 2);
  ground.translate(0, 0, -400);
  statics.add(ground, new MeshBasicMaterial({ color: 0x0a0708 }));

  skyline(kit, { count: tier === "low" ? 90 : 150, xSpread: 900, zNear: -260, zFar: -800, height: [30, 180], beacons });
  skyline(kit, { count: 26, xSpread: 500, zNear: -40, zFar: -120, size: [12, 26], height: [8, 30] });

  // The tower: finished floors below, an open frame and scaffold above.
  const top = steppedTower(kit, { ...TOWER, tiers: TIERS, built: BUILT, material: kit.windowMaterials[0]!, edgeColor: 0xffb347, edgeOpacity: 0.35, beacons });
  let acc = 0, width = TIERS[0]![0];
  for (const [w, h] of TIERS) {
    if (acc + h > top) {
      width = w;
      break;
    }
    acc += h;
  }
  const half = width / 2;
  const frameTop = top + 16;
  const colGeo = (x: number, z: number) => {
    const c = new BoxGeometry(0.8, frameTop - top, 0.8);
    c.translate(TOWER.x + x, top + (frameTop - top) / 2, TOWER.z + z);
    return c;
  };
  for (let x = -half; x <= half + 0.01; x += width / 4) for (const z of [-half, half]) statics.add(colGeo(x, z), dark);
  for (let z = -half + width / 4; z < half; z += width / 4) for (const x of [-half, half]) statics.add(colGeo(x, z), dark);
  for (const y of [top + 4, top + 8, top + 12]) {
    const slab = new BoxGeometry(width, 0.6, width);
    slab.translate(TOWER.x, y, TOWER.z);
    if (y < top + 9) statics.add(slab, dark);
    else slab.dispose();
  }

  // Scaffold: a lattice on all four faces around the build line.
  const scaffold: number[] = [];
  const sx = half + 2, y0 = top - 28, y1 = frameTop + 2;
  for (const [ax, az, bx, bz] of [[-sx, -sx, sx, -sx], [sx, -sx, sx, sx], [sx, sx, -sx, sx], [-sx, sx, -sx, -sx]] as const) {
    const len = Math.hypot(bx - ax, bz - az);
    for (let d = 0; d <= len + 0.01; d += 4) {
      const k = d / len, x = TOWER.x + ax + (bx - ax) * k, z = TOWER.z + az + (bz - az) * k;
      scaffold.push(x, y0, z, x, y1, z);
    }
    for (let y = y0; y <= y1; y += 4) scaffold.push(TOWER.x + ax, y, TOWER.z + az, TOWER.x + bx, y, TOWER.z + bz);
  }
  const scaffoldGeo = new BufferGeometry();
  scaffoldGeo.setAttribute("position", new Float32BufferAttribute(scaffold, 3));
  statics.addLines(scaffoldGeo, new LineBasicMaterial({ color: 0xffb347, transparent: true, opacity: 0.28 }));

  // Work lights on the scaffold and floodlights on the frame.
  for (let i = 0; i < 28; i++) {
    const face = Math.floor(rng.next() * 4), along = (rng.next() - 0.5) * 2 * sx, y = y0 + rng.next() * (y1 - y0);
    const [x, z] = face === 0 ? [along, -sx] : face === 1 ? [sx, along] : face === 2 ? [along, sx] : [-sx, along];
    glows.add(0xffb347, TOWER.x + x, y, TOWER.z + z, 3, 3, 0.75);
  }
  for (const [x, z] of [[-half, -half], [half, -half], [-half, half], [half, half]] as const) {
    glows.add(0xe9f4ff, TOWER.x + x, frameTop, TOWER.z + z, 9, 9, 0.55);
  }

  // Site floor: sodium lamps on wet ground, a perimeter fence of small lights.
  for (let i = 0; i < 14; i++) {
    const x = (rng.next() - 0.5) * 160, z = TOWER.z + 50 + rng.next() * 60;
    glows.add(0xffa040, x, 8, z, 4, 4, 0.8);
    streaks.add(0xffa040, x, z, 2, 14, 0.18);
  }
  for (let x = -90; x <= 90; x += 6) glows.add(0xff6a3d, x, 2, TOWER.z + 115, 1, 1, 0.6);

  // Tower cranes: mast with lattice edges, a slewing jib with trolley, hook and load.
  const edgeMat = new LineBasicMaterial({ color: 0xffd59a, transparent: true, opacity: 0.5 });
  const cranes = [
    { x: TOWER.x - half - 14, z: TOWER.z + 6, ph: 0.4, base: -0.6, jib: 70 },
    { x: TOWER.x + half + 12, z: TOWER.z - 12, ph: 2.1, base: 2.4, jib: 60 },
  ].map((c) => {
    const h = frameTop + 38;
    const mast = new BoxGeometry(3, h, 3);
    mast.translate(c.x, h / 2, c.z);
    statics.add(mast, dark);
    for (let y = 0; y < h; y += 6) statics.addLines(boxEdges(c.x, y + 3, c.z, 3.2, 6, 3.2), edgeMat);
    const head = new Group();
    head.position.set(c.x, h, c.z);
    const jib = new Mesh(new BoxGeometry(c.jib, 2, 2), dark);
    jib.position.x = c.jib / 2;
    const counter = new Mesh(new BoxGeometry(18, 2, 2.4), dark);
    counter.position.x = -9;
    const weight = new Mesh(new BoxGeometry(5, 4, 4), dark);
    weight.position.set(-15, -2, 0);
    const cab = new Mesh(new BoxGeometry(3.5, 3, 3.5), new MeshBasicMaterial({ color: 0x2a1a10 }));
    cab.position.set(2, -2.5, 0);
    const jibEdges = new LineSegments(boxEdges(c.jib / 2 - 9, 0, 0, c.jib + 18, 2.2, 2.2), edgeMat);
    const cableGeo = new BufferGeometry();
    const cableAttr = new Float32BufferAttribute(new Float32Array(6), 3);
    cableGeo.setAttribute("position", cableAttr);
    const cable = new LineSegments(cableGeo, new LineBasicMaterial({ color: 0x8a7a70 }));
    cable.frustumCulled = false;
    const load = new Mesh(new BoxGeometry(6, 2, 2), dark);
    head.add(jib, counter, weight, cab, jibEdges, cable, load);
    scene.add(head);
    const tip = glows.add(0xff2244, 0, 0, 0, 3, 3, 0.9);
    const trolleyLight = glows.add(0xffe0a8, 0, 0, 0, 2.2, 2.2, 0.8);
    beacons.add(c.x, h + 4, c.z, 3.5);
    return { ...c, h, head, cableAttr, load, tip, trolleyLight };
  });

  // Welding: short bursts of blue-white light with falling sparks.
  const SPARKS = tier === "low" ? 18 : 36;
  const welders = Array.from({ length: tier === "low" ? 3 : 5 }, () => {
    const side = Math.floor(rng.next() * 4), along = (rng.next() - 0.5) * width * 0.9;
    const [x, z] = side === 0 ? [along, -half] : side === 1 ? [half, along] : side === 2 ? [along, half] : [-half, along];
    const y = top + 0.8 + Math.floor(rng.next() * 2) * 4;
    return {
      x: TOWER.x + x,
      y,
      z: TOWER.z + z,
      core: glows.add(0xcfe8ff, TOWER.x + x, y, TOWER.z + z, 5, 5, 0),
      ph: rng.next() * 20,
      sparks: Array.from({ length: SPARKS }, () => ({ id: glows.add(0xffd59a, 0, -100, 0, 0.5, 0.5, 0), x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, life: 0 })),
    };
  });
  kit.finish();

  function updateCranes(t: number) {
    for (const c of cranes) {
      const angle = c.base + Math.sin(t * 0.05 + c.ph) * 0.7;
      c.head.rotation.y = angle;
      const trolley = c.jib * (0.45 + 0.35 * Math.sin(t * 0.09 + c.ph * 2));
      const drop = 18 + 8 * Math.sin(t * 0.13 + c.ph);
      c.cableAttr.setXYZ(0, trolley, -1, 0);
      c.cableAttr.setXYZ(1, trolley, -drop, 0);
      c.cableAttr.needsUpdate = true;
      c.load.position.set(trolley, -drop - 1, 0);
      const cos = Math.cos(angle), sin = Math.sin(angle);
      glows.setPosition(c.tip, c.x + cos * c.jib, c.h + 1.5, c.z - sin * c.jib);
      glows.setPosition(c.trolleyLight, c.x + cos * trolley, c.h - 1.5, c.z - sin * trolley);
    }
  }

  function updateWelders(dt: number, t: number) {
    for (const w of welders) {
      const active = Math.sin(t * 0.7 + w.ph) > 0.1;
      glows.setOpacity(w.core, active ? 0.4 + rng.next() * 0.6 : 0);
      for (const s of w.sparks) {
        if (s.life <= 0) {
          if (!active || !rng.chance(0.08)) {
            glows.setOpacity(s.id, 0);
            continue;
          }
          s.x = w.x;
          s.y = w.y;
          s.z = w.z;
          const a = rng.next() * Math.PI * 2, sp = 3 + rng.next() * 6;
          s.vx = Math.cos(a) * sp;
          s.vz = Math.sin(a) * sp;
          s.vy = rng.next() * 5;
          s.life = 0.6 + rng.next() * 0.9;
        }
        s.life -= dt;
        s.vy -= 22 * dt;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        s.z += s.vz * dt;
        glows.setPosition(s.id, s.x, s.y, s.z);
        glows.setOpacity(s.id, Math.max(0, Math.min(1, s.life * 1.5)));
      }
    }
  }

  function placeCamera(t: number) {
    camera.position.set(Math.sin(t * 0.04) * 14 + pointer.x * 8, 50 + Math.sin(t * 0.06) * 2 - pointer.y * 5, 80);
    // Frame the tower right of centre: landing-page content sits on the left.
    camera.lookAt(TOWER.x - 70 + pointer.x * 20, top - 30 - pointer.y * 12, TOWER.z);
  }

  return {
    update(dt, t) {
      updateCranes(t);
      updateWelders(dt, t);
      beacons.update(t);
      kit.commit();
      placeCamera(t);
    },
    still() {
      beacons.steady();
      for (const w of welders) glows.setOpacity(w.core, 0.8);
      kit.commit();
    },
    dispose() {},
  };
}
