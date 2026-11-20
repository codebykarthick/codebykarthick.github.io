import { BoxGeometry, LineBasicMaterial, MeshBasicMaterial, PlaneGeometry } from "three";
import { createBeacons } from "./kit/beacons";
import { boxEdges, buildingGeometry } from "./kit/buildings";
import { skyline } from "./kit/city";
import { applyAtmosphere, ATMOSPHERES, createKit } from "./kit/index";
import { octilinear, Polyline } from "./kit/paths";
import { createTraffic } from "./kit/traffic";
import type { SceneContext, SceneInstance, SceneMeta } from "./types";

/** Tech stack: an elevated metro network, trains running between stations on glowing lines. */
export const meta: SceneMeta = {
  id: "metro",
  seed: 4417,
  camera: { fov: 50, narrowFov: 66, near: 1, far: 1800 },
  bloom: { strength: 0.8, radius: 0.45, threshold: 0.78 },
  settleTime: 3,
};

const STATIONS: ReadonlyArray<readonly [number, number]> = [
  [-170, -40], [-70, -70], [40, -30], [150, -90], [-130, -210], [0, -190],
  [120, -240], [-50, -330], [80, -380], [-200, -390], [220, -320], [-10, -480],
];

const LINES: ReadonlyArray<{ color: number; y: number; stops: readonly number[]; trains: number }> = [
  { color: 0x3ff0ff, y: 46, stops: [0, 1, 2, 3, 6, 10], trains: 3 },
  { color: 0xffb347, y: 54, stops: [4, 1, 5, 6, 8, 11], trains: 3 },
  { color: 0xff2e88, y: 40, stops: [9, 7, 5, 2], trains: 2 },
];

export function create(ctx: SceneContext): SceneInstance {
  const { camera, pointer, tier, rng } = ctx;
  applyAtmosphere(ctx.scene, ATMOSPHERES.metro);
  const kit = createKit(ctx, { glowCapacity: 1600, streakCapacity: 10 });
  const { statics, glows, dark } = kit;
  const beacons = createBeacons(kit);

  const ground = new PlaneGeometry(3000, 3000);
  ground.rotateX(-Math.PI / 2);
  ground.translate(0, 0, -400);
  statics.add(ground, new MeshBasicMaterial({ color: 0x04050c }));

  // Low city under the network, keeping clear of the stations.
  skyline(kit, {
    count: tier === "low" ? 160 : 280,
    xSpread: 900,
    zNear: 60,
    zFar: -900,
    size: [10, 24],
    height: [8, 70],
    beacons,
    beaconAbove: 55,
  });

  // Stations: a tower with a lit platform where lines meet.
  const platformEdges = new LineBasicMaterial({ color: 0x3ff0ff, transparent: true, opacity: 0.55 });
  STATIONS.forEach(([x, z]) => {
    const h = 70 + rng.next() * 60;
    statics.add(buildingGeometry(rng, x, z, 12, 12, h), kit.windowMaterials[1]!);
    const deck = new BoxGeometry(22, 1.2, 22);
    deck.translate(x, 50, z);
    statics.add(deck, dark);
    statics.addLines(boxEdges(x, 50, z, 22, 1.2, 22), platformEdges);
    for (const [cx, cz] of [[-11, -11], [11, -11], [-11, 11], [11, 11]] as const) glows.add(0xa6f6ff, x + cx, 50.8, z + cz, 3, 3, 0.5);
    beacons.add(x, h + 1.5, z, 4);
  });

  // Lines: glowing rail on pylons, a soft glow strip along it, trains as strings of lights.
  const trains: Array<{ line: Polyline; s: number; dir: number; speed: number; cars: number[] }> = [];
  for (const line of LINES) {
    const route = new Polyline(octilinear(line.stops.map((i) => STATIONS[i]!), line.y));
    const railMat = new MeshBasicMaterial({ color: line.color });
    for (const [a, b] of route.segments()) {
      const dx = b[0] - a[0], dz = b[2] - a[2];
      const len = Math.hypot(dx, dz);
      const rail = new BoxGeometry(1.1, 0.5, len);
      rail.rotateY(Math.atan2(dx, dz));
      rail.translate((a[0] + b[0]) / 2, line.y, (a[2] + b[2]) / 2);
      statics.add(rail, railMat);
      const beam = new BoxGeometry(2.2, 1.4, len);
      beam.rotateY(Math.atan2(dx, dz));
      beam.translate((a[0] + b[0]) / 2, line.y - 1, (a[2] + b[2]) / 2);
      statics.add(beam, dark);
    }
    const p = { x: 0, y: 0, z: 0 };
    for (let s = 0; s < route.length; s += 7) {
      route.at(s, p);
      glows.add(line.color, p.x, p.y, p.z, 5, 2.6, 0.35);
    }
    for (let s = 12; s < route.length; s += 34) {
      route.at(s, p);
      const pylon = new BoxGeometry(1.4, p.y - 1.5, 1.4);
      pylon.translate(p.x, (p.y - 1.5) / 2, p.z);
      statics.add(pylon, dark);
    }
    for (let i = 0; i < line.trains; i++) {
      const cars: number[] = [];
      for (let c = 0; c < 6; c++) cars.push(glows.add(c === 0 ? 0xffffff : line.color, 0, line.y + 1.2, 0, c === 0 ? 3.4 : 2.6, 1.6, c === 0 ? 0.95 : 0.75));
      trains.push({ line: route, s: (route.length * (i + rng.next() * 0.5)) / line.trains, dir: rng.chance(0.5) ? 1 : -1, speed: 16 + rng.next() * 8, cars });
    }
  }

  const traffic = createTraffic(kit, {
    zMin: -900,
    zMax: 120,
    air: { count: tier === "low" ? 12 : 24, lanes: [72, 84, 98], spread: () => 500, speed: [20, 40] },
  });
  kit.finish();

  const p = { x: 0, y: 0, z: 0 };
  function moveTrains(dt: number) {
    for (const tr of trains) {
      tr.s += tr.dir * tr.speed * dt;
      if (tr.s > tr.line.length) {
        tr.s = tr.line.length;
        tr.dir = -1;
      } else if (tr.s < 0) {
        tr.s = 0;
        tr.dir = 1;
      }
      tr.cars.forEach((id, c) => {
        tr.line.at(tr.s - tr.dir * c * 3.2, p);
        glows.setPosition(id, p.x, p.y + 1.2, p.z);
      });
    }
  }

  function placeCamera(t: number) {
    camera.position.set(Math.sin(t * 0.03) * 30 + pointer.x * 12, 150 - pointer.y * 8, 150 + Math.sin(t * 0.02) * 10);
    camera.lookAt(pointer.x * 30, -60 - pointer.y * 10, -230);
  }

  return {
    update(dt, t) {
      moveTrains(dt);
      traffic.update(dt);
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
