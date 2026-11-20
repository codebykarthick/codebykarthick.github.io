# Engine contract

Source: `src/scenes/engine.ts`, `src/scenes/types.ts`, `src/scenes/prefs.ts`, `src/scenes/boot.ts`.

## Types

```ts
type Tier = "low" | "medium" | "high";
type SceneMode = "full" | "ambient";
type SceneId = "home" | "metro" | "archive" | "construction" | "rooftop" | "desert";

interface SceneContext {
  scene: Scene;
  camera: PerspectiveCamera;      // created by the engine from meta.camera; the scene positions it
  renderer: WebGLRenderer;
  rng: Rng;                       // seeded from meta.seed: next(), range(a,b), pick(arr), chance(p)
  tier: Tier;                     // tier at creation; use it for density
  mode: SceneMode;
  glowGain: { value: number };    // shader-uniform shaped; < 1 while bloom is on
  pointer: { x: number; y: number }; // smoothed −1..1; 0 in ambient mode
  narrow: boolean;                // viewport < 700 px at creation
  maxAnisotropy: number;
  track<T extends { dispose(): void }>(item: T): T; // dispose with the scene
}

interface SceneInstance {
  update(dt: number, t: number): void; // dt clamped to 0.05 s; t = scene seconds
  still?(): void;                      // before a still frame
  dispose(): void;
}

interface SceneMeta {
  id: SceneId;
  seed: number;
  camera: { fov: number; narrowFov: number; near: number; far: number };
  bloom: { strength: number; radius: number; threshold: number };
  settleTime: number;
}
```

## Lifecycle

1. `Engine.create({ canvas, host, mode, module, sentinel })`:
   - Picks the tier: `?tier=` override (not persisted), else `localStorage['scenes:tier']`, else `autoTier()`, which is then persisted.
   - Creates the `WebGLRenderer` (antialias off on low). Returns `null` if that throws.
   - Sets `ColorManagement.enabled = false` and `outputColorSpace = LinearSRGBColorSpace`. Colours are display values, as in the r128 PoC. Don't set `texture.colorSpace`.
   - Calls `module.create(ctx)` synchronously.
   - On high tier in full mode, lazy-loads `EffectComposer` + `RenderPass` + `UnrealBloomPass` + `OutputPass` (MSAA ×4 half-float target).
2. First frame:
   - With reduced motion or the user's pause set: `t` jumps to 10, then `update(1/60, 10)`, then `still()`, then render.
   - Otherwise `update(0, 0)` and render.
   - Then `host.classList.add("is-ready")` fades the canvas in, and the engine dispatches `scenes:ready`, which reveals the pause toggle.
3. Loop: `requestAnimationFrame` runs only while there are no pause reasons:
   - `user`: `localStorage['scenes:paused'] === "1"`, toggled with the `scenes:pause` event
   - `hidden`: `document.hidden`
   - `offscreen`: the full-mode sentinel is out of view
   - `frozen`: ambient after `settleTime`
   - `motion`: `prefers-reduced-motion`, which is live
4. FPS monitor: after 2 s, if the 1 s average stays under 40 fps three times in a row, the engine drops a tier, persists it, and turns bloom off below high (which restores `glowGain` to 1 and reduces pixel ratio). It never runs when the tier was forced with `?tier=`.
5. Resize: pixel ratio and size update, `fov` switches to `narrowFov` below 700 px, and the engine redraws once if stopped.
6. `dispose()` runs on `pagehide` unless the page goes into bfcache. It cancels the loop, removes listeners, calls `instance.dispose()`, traverses the scene disposing geometries, materials, material textures and ShaderMaterial uniform textures, disposes the background and every `ctx.track()`ed item, then the composer and the renderer.

## Pixel ratio

| tier | full | ambient |
|---|---|---|
| low | min(dpr, 0.75) | × 0.6 |
| medium | min(dpr, 1) | × 0.6 |
| high | min(dpr, 1.5) | × 0.6 |

## Page-side API (`prefs.ts`, three-free)

- `PAUSE_KEY = "scenes:paused"`, `TIER_KEY = "scenes:tier"`
- `PAUSE_EVENT = "scenes:pause"`: `CustomEvent<boolean>` on `window`
- `READY_EVENT = "scenes:ready"`: an engine is running
- `readPaused()`, `storageGet()`, `storageSet()` (all wrapped in try/catch)

## Debugging

- `?debug-scenes` → `window.__scene` (the Engine).
- `__scene.info()` → `{ geometries, textures, calls, tier }`. `calls` reads 1 with bloom on, because the last composer pass resets the counter, so measure on `?tier=medium`.
- `__scene.raf === 0` means the loop is stopped.
