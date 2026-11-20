---
name: cyberpunk-scenes
description: Build or change a procedural three.js background scene for a page on this site (megacity, metro, archive, construction, rooftop, desert). Covers the scene engine contract, the shared kit, full vs ambient modes, quality tiers, the performance budget, CSS fallbacks, originality rules and a test checklist. Use whenever touching src/scenes/ or a page's scene.
---

# Building a page scene

Every page has a fixed, `aria-hidden` scene layer behind its content. One shared engine (`src/scenes/engine.ts`) runs a scene module, and scenes are assembled from the shared kit (`src/scenes/kit/`) that was extracted from `reference/poc-index.html`. Never copy-paste one scene into another: move shared pieces into the kit instead.

## How a page gets its scene

1. A layout renders `<SceneHost scene="<id>" mode="full|ambient" />`. `Landing.astro` uses full mode and `Reading.astro` uses ambient.
2. SceneHost outputs the CSS fallback (`background: var(--scene-<id>)`) and, if the scene is registered, a canvas.
3. After first paint and an idle callback, with WebGL available, it dynamically imports `scenes/boot.ts` → `registry.ts` → the scene module → `Engine.create()`.
4. The canvas fades in over the gradient. Without WebGL or JS, the gradient stays.

Never import `three` from a page, component or `prefs.ts`. It must only enter through `boot.ts`, so it stays out of the critical path.

## The contract

```ts
// src/scenes/<id>.ts
import type { SceneContext, SceneInstance, SceneMeta } from "./types";

export const meta: SceneMeta = {
  id: "<id>",
  seed: 1234,                                   // same seed, same city
  camera: { fov: 58, narrowFov: 70, near: 0.5, far: 1000 },
  bloom: { strength: 0.7, radius: 0.4, threshold: 0.86 },
  settleTime: 3.5,                              // ambient freezes after this many seconds
};

export function create(ctx: SceneContext): SceneInstance {
  applyAtmosphere(ctx.scene, ATMOSPHERES["<id>"]);
  const kit = createKit(ctx);
  // …build with kit systems…
  kit.finish();                                 // merge statics, add glow and streak fields
  return {
    update(dt, t) { /* animate systems */ kit.commit(); /* place camera */ },
    still() { /* optional: steady lights for a still frame */ kit.commit(); },
    dispose() { /* only things outside the scene graph and ctx.track */ },
  };
}
```

The full API is in [references/engine-contract.md](references/engine-contract.md) and [references/kit-api.md](references/kit-api.md).

## Full vs ambient

| | full | ambient |
|---|---|---|
| Used on | home and section index pages (`Landing`) | detail and reading pages (`Reading`) |
| Resolution | tier pixel ratio | tier pixel ratio × 0.6 |
| Motion | continuous; pauses when `[data-scene-sentinel]` (the hero) scrolls out of view | intro only; freezes at `meta.settleTime`, then redraws only on resize |
| Bloom | high tier only | never |
| Pointer parallax | yes (`ctx.pointer`) | no (pointer stays 0) |
| Look | veil on the left for hero text | canvas at 55% opacity under a flat veil |

Design each scene so the frame at `settleTime` looks good when frozen: signs lit, nothing mid-flicker.

## Quality tiers

`low | medium | high`, read from `ctx.tier`.
- The engine picks a tier from device signals, persists it in `localStorage['scenes:tier']`, and drops a tier if the frame rate stays under 40 fps for 3 s. Pixel ratio and bloom change live; density changes apply on the next load.
- Scenes scale their own density by tier, for example rain 900 / 1800 / 2600 drops and signs 40 / 80 / 140.
- `ctx.glowGain.value` is below 1 while real bloom runs. Kit glow systems read it automatically. If you hand-roll an additive material, multiply its opacity by it.

## Performance budget

- Draw calls, measured with `?tier=medium&debug-scenes` → `__scene.info().calls`: ≤ 120 on low and medium, ≤ 300 on high. Home is about 67 on medium and 58 on low; see catalog.md for the rest.
- Use `kit.statics` for anything that doesn't move, `kit.glows` for every point light (one instanced draw call for all of them), and `kit.streaks` for ground reflections.
- Avoid `DoubleSide` on transparent meshes: three.js draws them twice. Use `forceSinglePass: true` or keep the camera on the front side.
- Scene module ≤ 15 KB gzipped. Scene build ≤ 100 ms on a mid-tier phone. No textures from the network: everything is procedural canvas.
- No per-frame allocations in `update`: reuse vectors, write into typed arrays.

## Fallback requirement

Every scene id needs a `--scene-<id>` gradient in `src/styles/tokens.css` that uses the same palette as its sky and fog (`kit/atmosphere.ts`). It's what people see before three.js loads, without WebGL, and during the view-transition crossfade, so the two must read as the same place.

## Originality rule

Scenes must be original. No real landmarks, brand logos, company names, or names, logos or signature designs from existing games, films or anime. Sign words in `kit/signs.ts` are generic shop words or invented brands. Check any new words against this rule.

## Scene catalog

| id | Page | Concept | Palette |
|---|---|---|---|
| home | `/` | Rain-soaked avenue, blade signs, wet-street streaks, air traffic, searchlights, stepped megatower | night #07050f, haze #2a1238, pink #ff2e88, cyan #3ff0ff, amber #ffb347 |
| metro | `/stack` | Elevated metro network, trains on glowing lines between towers (a map of connected tech) | deep indigo, cyan and amber line glow |
| archive | `/knowledge` | Underground data archive, endless server-rack corridor, blinking status LEDs, cold-aisle fog | blue-black, teal-cyan, small amber warnings |
| construction | `/projects` | Cranes assembling a half-built megatower, welding sparks, scaffolding lights | warm haze, sodium amber, blue-white sparks |
| rooftop | `/ideas` | Rooftop looking up, antenna forest, drifting drones, searchlights in low cloud | violet cloud, pink underglow, cyan beams |
| desert | `/about` | Desert highway at dusk, solar fields, a lone hauler truck, the city glowing on the horizon | amber → pink → violet sky, cyan and pink horizon |
| (404) | `404` | Static CSS skyline and neon sign, no three.js | home palette |

Per-scene notes, camera ideas and kit reuse are in [references/catalog.md](references/catalog.md).

## Checklist for a new or changed scene

1. Create `src/scenes/<id>.ts` exporting `meta` and `create`.
2. Register it in `src/scenes/registry.ts` (`<id>: () => import("./<id>")`) and add `<id>` to `SceneId` in `types.ts` if it's new.
3. Add `ATMOSPHERES.<id>` in `kit/atmosphere.ts` and the matching `--scene-<id>` gradient in `tokens.css`.
4. `npm run build && npm run preview`, then open the page:
   - `?tier=low`, `?tier=medium`, `?tier=high`: all look intentional; check draw calls with `&debug-scenes`.
   - DevTools → Rendering → emulate `prefers-reduced-motion: reduce`: a single, settled still frame.
   - The footer "Pause scenes" toggle stops and resumes motion, and the choice persists across pages.
   - Scroll the hero out of view (full mode): the loop stops (`__scene.raf === 0`).
   - Ambient page: motion stops after `settleTime`.
   - Disable WebGL (`chrome://flags` or `--disable-webgl`): the gradient only, no errors.
   - `__scene.dispose(); __scene.info()` → `geometries: 0, textures: 0`.
5. Check text contrast on the page over the busiest part of the scene. Body text on reading pages sits on `.panel--solid`, so it must pass AA whatever the scene does.
6. Check originality: no landmarks, logos or borrowed names.
