import { Color, EquirectangularReflectionMapping, FogExp2, type Scene } from "three";
import type { SceneId } from "../types";
import { canvasTexture, makeCanvas } from "./canvas";

export interface Atmosphere {
  /**
   * Vertical sky gradient. By default it's stretched over the screen, top (0) to bottom (1).
   * With `world: true` it's mapped to elevation instead: 0 = straight up, 0.5 = horizon, 1 = straight down,
   * which keeps a horizon glow on the horizon wherever the camera looks.
   */
  sky: Array<[number, string]>;
  world?: boolean;
  fog: { color: number; density: number };
}

/** Sky and fog per scene. Keep each in step with its --scene-* fallback gradient in tokens.css. */
export const ATMOSPHERES: Record<SceneId, Atmosphere> = {
  home: {
    sky: [[0, "#04020a"], [0.45, "#120822"], [0.78, "#2a1238"], [1, "#4a1a48"]],
    fog: { color: 0x2a1238, density: 0.004 },
  },
  metro: {
    sky: [[0, "#03040c"], [0.5, "#0b0f2a"], [0.8, "#162a55"], [1, "#24407a"]],
    fog: { color: 0x101a3a, density: 0.0017 },
  },
  archive: {
    sky: [[0, "#020509"], [0.6, "#05121a"], [1, "#0b2a36"]],
    fog: { color: 0x061a22, density: 0.045 },
  },
  construction: {
    sky: [[0, "#05030a"], [0.45, "#1d0d16"], [0.8, "#4a2414"], [1, "#7a3a1a"]],
    fog: { color: 0x3a1c16, density: 0.0022 },
  },
  rooftop: {
    sky: [[0, "#5a2a6a"], [0.35, "#3a1650"], [0.75, "#1c0b2c"], [1, "#0a0614"]],
    fog: { color: 0x2e1440, density: 0.006 },
  },
  desert: {
    sky: [[0, "#05030f"], [0.28, "#1c0c36"], [0.4, "#3c1656"], [0.46, "#8a2e62"], [0.485, "#d65a6c"], [0.497, "#ff9a58"], [0.5, "#ffc070"], [0.505, "#3a1626"], [1, "#0a0508"]],
    world: true,
    fog: { color: 0x7a3050, density: 0.0007 },
  },
};

export function skyTexture(stops: Atmosphere["sky"]) {
  const { canvas, g } = makeCanvas(2, 512);
  const gr = g.createLinearGradient(0, 0, 0, 512);
  for (const [at, color] of stops) gr.addColorStop(at, color);
  g.fillStyle = gr;
  g.fillRect(0, 0, 2, 512);
  return canvasTexture(canvas);
}

export function applyAtmosphere(scene: Scene, atmosphere: Atmosphere): void {
  const sky = skyTexture(atmosphere.sky);
  if (atmosphere.world) sky.mapping = EquirectangularReflectionMapping;
  scene.background = sky;
  scene.fog = new FogExp2(new Color(atmosphere.fog.color), atmosphere.fog.density);
}
