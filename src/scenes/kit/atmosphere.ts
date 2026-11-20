import { Color, FogExp2, type Scene } from "three";
import type { SceneId } from "../types";
import { canvasTexture, makeCanvas } from "./canvas";

export interface Atmosphere {
  /** Vertical sky gradient, top (0) to horizon (1). */
  sky: Array<[number, string]>;
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
    fog: { color: 0x101a3a, density: 0.0045 },
  },
  archive: {
    sky: [[0, "#020509"], [0.6, "#05121a"], [1, "#0b2a36"]],
    fog: { color: 0x07202a, density: 0.022 },
  },
  construction: {
    sky: [[0, "#05030a"], [0.45, "#1d0d16"], [0.8, "#4a2414"], [1, "#7a3a1a"]],
    fog: { color: 0x3a1c16, density: 0.0045 },
  },
  rooftop: {
    sky: [[0, "#5a2a6a"], [0.35, "#3a1650"], [0.75, "#1c0b2c"], [1, "#0a0614"]],
    fog: { color: 0x2e1440, density: 0.006 },
  },
  desert: {
    sky: [[0, "#120826"], [0.4, "#3a1650"], [0.72, "#a8405a"], [0.9, "#e0784a"], [1, "#ffb347"]],
    fog: { color: 0x5a2048, density: 0.0028 },
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
  scene.background = skyTexture(atmosphere.sky);
  scene.fog = new FogExp2(new Color(atmosphere.fog.color), atmosphere.fog.density);
}
