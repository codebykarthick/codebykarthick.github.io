import { RepeatWrapping, type CanvasTexture } from "three";
import type { Rng } from "../types";
import { canvasTexture, makeCanvas } from "./canvas";

/** Soft radial falloff, white with an alpha gradient. Tinted by GlowField. */
export function glowTexture(): CanvasTexture {
  const s = 128;
  const { canvas, g } = makeCanvas(s, s);
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, "rgba(255,255,255,1)");
  gr.addColorStop(0.18, "rgba(255,255,255,0.6)");
  gr.addColorStop(0.5, "rgba(255,255,255,0.12)");
  gr.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, s, s);
  return canvasTexture(canvas);
}

/** Wet-street reflection: bright centre line fading along its length. */
export function streakTexture(): CanvasTexture {
  const w = 32, h = 256;
  const { canvas, g } = makeCanvas(w, h);
  const gx = g.createLinearGradient(0, 0, w, 0);
  gx.addColorStop(0, "rgba(255,255,255,0)");
  gx.addColorStop(0.5, "rgba(255,255,255,1)");
  gx.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = gx;
  g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = "destination-in";
  const gy = g.createLinearGradient(0, 0, 0, h);
  gy.addColorStop(0, "rgba(0,0,0,1)");
  gy.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gy;
  g.fillRect(0, 0, w, h);
  return canvasTexture(canvas);
}

export interface WindowPalette {
  cols: readonly string[];
  /** Fraction of windows lit. */
  d: number;
}

export const WIN_PALETTES: readonly WindowPalette[] = [
  { cols: ["#ffb347", "#ffd59a", "#ff9a5c"], d: 0.4 },
  { cols: ["#3ff0ff", "#a6f6ff", "#cfd9ff"], d: 0.32 },
  { cols: ["#ff2e88", "#ffb347", "#efe6ff"], d: 0.28 },
  { cols: ["#e9eeff", "#a9c4ff"], d: 0.16 },
  { cols: ["#ffb347", "#e9eeff"], d: 0.5 },
  { cols: ["#8a73ff", "#3ff0ff", "#e9eeff"], d: 0.24 },
];

/** 8×16 window grid on a dark facade, with occasional fully lit floors. Tiles on both axes. */
export function windowTexture(p: WindowPalette, rng: Rng, anisotropy: number): CanvasTexture {
  const W = 128, H = 256;
  const { canvas, g } = makeCanvas(W, H);
  g.fillStyle = "#08070f";
  g.fillRect(0, 0, W, H);
  const cols = 8, rows = 16, cw = W / cols, rh = H / rows;
  for (let y = 0; y < rows; y++) {
    const floorLit = rng.chance(0.12);
    for (let x = 0; x < cols; x++) {
      if (floorLit || rng.chance(p.d)) {
        g.globalAlpha = 0.3 + rng.next() * 0.7;
        g.fillStyle = rng.pick(p.cols);
        g.fillRect(x * cw + 3, y * rh + 5, cw - 6, rh - 9);
      }
    }
  }
  g.globalAlpha = 1;
  const t = canvasTexture(canvas);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.anisotropy = anisotropy;
  return t;
}
