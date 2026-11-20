import { MeshBasicMaterial, PlaneGeometry, type Texture } from "three";
import type { Rng, SceneContext } from "../types";
import { GlowField } from "./glow";
import { StaticBatch } from "./merge";
import { StreakField } from "./streaks";
import { glowTexture, streakTexture, windowTexture, WIN_PALETTES, type WindowPalette } from "./textures";

/** Shared resources for one scene. Create once in create(ctx), call finish() after building. */
export interface Kit {
  ctx: SceneContext;
  rng: Rng;
  glows: GlowField;
  streaks: StreakField;
  statics: StaticBatch;
  textures: { glow: Texture; streak: Texture };
  windowMaterials: MeshBasicMaterial[];
  dark: MeshBasicMaterial;
  unitPlane: PlaneGeometry;
  /** Flushes static batches and adds the glow and streak fields to the scene. */
  finish(): void;
  /** Uploads changed glow and streak data. Call at the end of every update. */
  commit(): void;
}

export interface KitOptions {
  glowCapacity?: number;
  streakCapacity?: number;
  palettes?: readonly WindowPalette[];
}

export function createKit(ctx: SceneContext, opts: KitOptions = {}): Kit {
  const glow = glowTexture();
  const streak = streakTexture();
  const glows = new GlowField(glow, opts.glowCapacity ?? 600, ctx.glowGain);
  const streaks = new StreakField(streak, opts.streakCapacity ?? 300, ctx.glowGain);
  const statics = new StaticBatch();
  const windowMaterials = (opts.palettes ?? WIN_PALETTES).map(
    (p) => new MeshBasicMaterial({ map: windowTexture(p, ctx.rng, ctx.maxAnisotropy) }),
  );
  return {
    ctx,
    rng: ctx.rng,
    glows,
    streaks,
    statics,
    textures: { glow, streak },
    windowMaterials,
    dark: new MeshBasicMaterial({ color: 0x0a0812 }),
    unitPlane: ctx.track(new PlaneGeometry(1, 1)),
    finish() {
      statics.flush(ctx.scene);
      ctx.scene.add(streaks.mesh, glows.mesh);
    },
    commit() {
      glows.commit();
      streaks.commit();
    },
  };
}

export { applyAtmosphere, ATMOSPHERES } from "./atmosphere";
export { buildingGeometry, boxEdges, type Frontage } from "./buildings";
export { createRng } from "./rng";
export { WIN_PALETTES, type WindowPalette } from "./textures";
