import { Vector3 } from "three";
import { createBeacons } from "./kit/beacons";
import { avenue, hangSigns, skyline, steppedTower, streetLamps, streetSurface } from "./kit/city";
import { applyAtmosphere, ATMOSPHERES, createKit } from "./kit/index";
import { createRain } from "./kit/rain";
import { createSearchlights } from "./kit/searchlights";
import { createSigns } from "./kit/signs";
import { createTraffic } from "./kit/traffic";
import type { SceneContext, SceneInstance, SceneMeta } from "./types";

/** Home: the rain-soaked avenue and stepped megatower from the PoC. */
export const meta: SceneMeta = {
  id: "home",
  seed: 20261120,
  camera: { fov: 58, narrowFov: 70, near: 0.5, far: 1000 },
  bloom: { strength: 0.7, radius: 0.4, threshold: 0.86 },
  settleTime: 3.5,
};

const ROAD = 7;

export function create(ctx: SceneContext): SceneInstance {
  const { tier, camera, pointer } = ctx;
  applyAtmosphere(ctx.scene, ATMOSPHERES.home);
  const kit = createKit(ctx, { glowCapacity: 800, streakCapacity: 400 });
  const beacons = createBeacons(kit);
  const signs = createSigns(kit);

  const fronts = avenue(kit, { road: ROAD, zNear: 16, zFar: -280, maxX: 90, beacons });
  skyline(kit, { count: tier === "low" ? 50 : 90, xSpread: 440, zNear: -300, zFar: -540, beacons });
  steppedTower(kit, {
    x: -10,
    z: -380,
    tiers: [[46, 90], [34, 80], [24, 70], [14, 50]],
    material: kit.windowMaterials[3]!,
    beacons,
  });
  streetSurface(kit, { road: ROAD, zNear: 16, zFar: -280 });
  streetLamps(kit, { road: ROAD, zNear: 14, zFar: -240 });
  hangSigns(kit, signs, fronts, { max: tier === "low" ? 40 : tier === "medium" ? 80 : 140 });

  const traffic = createTraffic(kit, {
    zMin: -300,
    zMax: 40,
    air: { count: 46, lanes: [12, 16, 22, 29, 38, 50], spread: (y) => (y > 30 ? 40 : 10), speed: [18, 48] },
    ground: { count: 20, x: 3.2, y: 0.7, speed: [10, 18] },
  });
  const rain = createRain(kit, {
    count: tier === "low" ? 900 : tier === "medium" ? 1800 : 2600,
    width: 70,
    height: 45,
    zMin: -50,
    zMax: 22,
  });
  const lights = createSearchlights(kit);
  lights.add(-60, -230, 0x7fe8ff);
  lights.add(70, -260, 0xff7ac0);
  lights.add(-10, -420, 0xb9a6ff);
  kit.finish();

  const target = new Vector3(0, 24, -160);
  function placeCamera(t: number) {
    camera.position.set(
      Math.sin(t * 0.05) * 1.2 + pointer.x * 2.2,
      7.5 + Math.sin(t * 0.07) * 0.5 - pointer.y * 1.4,
      24 + Math.sin(t * 0.031) * 3,
    );
    camera.lookAt(target.x + pointer.x * 6, target.y - pointer.y * 4, target.z);
  }

  return {
    update(dt, t) {
      signs.update(t);
      beacons.update(t);
      traffic.update(dt);
      rain.update(dt);
      lights.update(t);
      kit.commit();
      placeCamera(t);
    },
    still() {
      beacons.steady();
      kit.commit();
    },
    dispose() {
      /* everything lives in the scene graph or ctx.track; the engine disposes it */
    },
  };
}
