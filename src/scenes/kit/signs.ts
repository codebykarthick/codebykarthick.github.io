import { Mesh, MeshBasicMaterial, type CanvasTexture } from "three";
import { canvasTexture, makeCanvas } from "./canvas";
import type { Kit } from "./index";

/** In-world signage. Original words only: no real brands or names from games and films. */
export const SIGN_WORDS = ["HOTEL", "BAR", "NOODLE", "24H", "CLINIC", "ラーメン", "ホテル", "KARAOKE", "PAWN", "DINER", "バー", "LIVE", "TATTOO", "ARCADE", "SOBA", "CAPSULE"] as const;
export const SIGN_COLORS = ["#ff2e88", "#3ff0ff", "#ffb347", "#b57bff", "#ff4d5e", "#ffe14d"] as const;
export const BOARD_WORDS = ["NEURAL SLEEP", "DRINK VOLT", "SYNTH SOY", "KIRA BANK", "HAPPY HOUR", "OPEN LATE"] as const;

const FONT = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';

interface SignState {
  m: MeshBasicMaterial;
  halo: number;
  streak: number;
  delay: number;
  flicker: boolean;
  ph: number;
  base: number;
}

export interface SignSystem {
  /** Vertical blade sign hung off a facade. */
  blade(word: string, color: string, x: number, y: number, z: number, w: number, reflect: boolean): void;
  bladeHeight(word: string, w: number): number;
  /** Horizontal rooftop billboard. */
  board(word: string, color: string, x: number, y: number, z: number, w: number, h: number): void;
  update(t: number): void;
  count(): number;
}

export function createSigns(kit: Kit): SignSystem {
  const cache = new Map<string, CanvasTexture>();
  const signs: SignState[] = [];
  const { rng, glows, streaks, ctx } = kit;

  function bladeTexture(word: string, color: string): CanvasTexture {
    const key = "b" + word + color;
    const hit = cache.get(key);
    if (hit) return hit;
    const chars = Array.from(word);
    const W = 96, H = Math.max(160, chars.length * 76 + 40);
    const { canvas, g } = makeCanvas(W, H);
    g.fillStyle = "rgba(10,6,18,0.94)";
    g.fillRect(0, 0, W, H);
    g.shadowColor = color;
    g.shadowBlur = 14;
    g.strokeStyle = color;
    g.lineWidth = 4;
    g.strokeRect(8, 8, W - 16, H - 16);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 54px ${FONT}`;
    g.fillStyle = color;
    chars.forEach((ch, i) => g.fillText(ch, W / 2, 20 + i * 76 + 38));
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255,255,255,0.5)";
    chars.forEach((ch, i) => g.fillText(ch, W / 2, 20 + i * 76 + 38));
    const t = canvasTexture(canvas);
    cache.set(key, t);
    return t;
  }

  function boardTexture(word: string, color: string): CanvasTexture {
    const key = "w" + word + color;
    const hit = cache.get(key);
    if (hit) return hit;
    const W = 512, H = 200;
    const { canvas, g } = makeCanvas(W, H);
    const bg = g.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, "#12081f");
    bg.addColorStop(1, "#070410");
    g.fillStyle = bg;
    g.fillRect(0, 0, W, H);
    g.shadowColor = color;
    g.shadowBlur = 18;
    g.strokeStyle = color;
    g.lineWidth = 3;
    g.strokeRect(10, 10, W - 20, H - 20);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `800 64px ${FONT}`;
    g.fillStyle = color;
    g.fillText(word, W / 2, H / 2 + 2);
    g.shadowBlur = 0;
    g.fillStyle = "rgba(255,255,255,0.45)";
    g.fillText(word, W / 2, H / 2 + 2);
    const t = canvasTexture(canvas);
    cache.set(key, t);
    return t;
  }

  function place(tex: CanvasTexture, color: string, x: number, y: number, z: number, w: number, h: number, reflect: boolean) {
    // Front side only: scenes keep the camera on the +z side of signs. DoubleSide would cost two draw calls each.
    const m = new MeshBasicMaterial({ map: tex, transparent: true, opacity: 0 });
    const p = new Mesh(kit.unitPlane, m);
    p.scale.set(w, h, 1);
    p.position.set(x, y, z);
    ctx.scene.add(p);
    const halo = glows.add(color, x, y, z - 0.2, w * 3.4, h * 1.5, 0);
    const streak = reflect ? streaks.add(color, x, z, w * 1.5, Math.min(20, y * 1.6), 0) : -1;
    signs.push({ m, halo, streak, delay: 0.3 + rng.next() * 2.4, flicker: rng.chance(0.18), ph: rng.next() * 100, base: 0.3 + rng.next() * 0.12 });
  }

  return {
    bladeHeight(word, w) {
      const n = Array.from(word).length;
      return (w * Math.max(160, n * 76 + 40)) / 96;
    },
    blade(word, color, x, y, z, w, reflect) {
      const tex = bladeTexture(word, color);
      place(tex, color, x, y, z, w, (w * tex.image.height) / tex.image.width, reflect);
    },
    board(word, color, x, y, z, w, h) {
      place(boardTexture(word, color), color, x, y, z, w, h, false);
    },
    update(t) {
      for (const s of signs) {
        const e = t - s.delay;
        let k: number;
        if (e < 0) k = 0;
        else if (e < 0.5) k = (Math.sin(e * 60) > 0 ? 1 : 0.15) * Math.min(1, e * 3);
        else k = 1;
        if (s.flicker && k === 1 && Math.sin(t * 7 + s.ph) + Math.sin(t * 23 + s.ph * 2) > 1.6) k = 0.2;
        s.m.opacity = k;
        glows.setOpacity(s.halo, s.base * k);
        streaks.setOpacity(s.streak, 0.22 * k);
      }
    },
    count: () => signs.length,
  };
}
