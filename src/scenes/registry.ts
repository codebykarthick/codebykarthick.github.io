import type { SceneId, SceneModule } from "./types";

/**
 * Page scenes, lazily loaded. A page whose scene isn't registered yet shows
 * its CSS fallback gradient only. See the cyberpunk-scenes skill to add one.
 */
export const SCENES: Partial<Record<SceneId, () => Promise<SceneModule>>> = {
  home: () => import("./home"),
};
