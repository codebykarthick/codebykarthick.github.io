import {
  ColorManagement,
  HalfFloatType,
  LinearSRGBColorSpace,
  PerspectiveCamera,
  Scene,
  Vector2,
  WebGLRenderTarget,
  WebGLRenderer,
  type Material,
  type Mesh,
  type ShaderMaterial,
  type Texture,
} from "three";
import type { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { createRng } from "./kit/rng";
import { PAUSE_EVENT, readPaused, storageGet, storageSet, TIER_KEY } from "./prefs";
import type { Disposable, SceneContext, SceneInstance, SceneMode, SceneModule, Tier } from "./types";

// Colours and textures are authored as display values, as in the r128 PoC.
// Turning colour management off keeps that look exactly and avoids sRGB decode work.
ColorManagement.enabled = false;

const TIERS: readonly Tier[] = ["low", "medium", "high"];
const BLOOM_GLOW_GAIN = 0.55;
/** Seconds into the timeline used for still frames (signs lit, traffic spread out). */
const STILL_TIME = 10;

type PauseReason = "user" | "hidden" | "offscreen" | "frozen" | "motion";

function isTier(v: string | null): v is Tier {
  return v !== null && (TIERS as readonly string[]).includes(v);
}

/** Device signals only. Unknown signals (Safari has no deviceMemory) don't count against a device. */
export function autoTier(gl2: boolean): Tier {
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (!gl2 || nav.connection?.saveData) return "low";
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory;
  if (cores <= 4 || (mem !== undefined && mem <= 2)) return "low";
  const coarse = matchMedia("(pointer: coarse)").matches;
  const dpr = window.devicePixelRatio || 1;
  const pixels = screen.width * screen.height * dpr * dpr;
  if (coarse || cores < 8 || (mem !== undefined && mem < 8) || pixels > 9e6) return "medium";
  return "high";
}

/** ?tier= overrides for this page load; otherwise the persisted tier; otherwise auto. */
export function pickTier(gl2: boolean): { tier: Tier; forced: boolean } {
  const param = new URLSearchParams(location.search).get("tier");
  if (isTier(param)) return { tier: param, forced: true };
  const stored = storageGet(TIER_KEY);
  if (isTier(stored)) return { tier: stored, forced: false };
  const tier = autoTier(gl2);
  storageSet(TIER_KEY, tier);
  return { tier, forced: false };
}

function pixelRatio(tier: Tier, mode: SceneMode): number {
  const dpr = window.devicePixelRatio || 1;
  const base = tier === "high" ? Math.min(dpr, 1.5) : tier === "medium" ? Math.min(dpr, 1) : Math.min(dpr, 0.75);
  return mode === "ambient" ? base * 0.6 : base;
}

function disposeMaterial(m: Material): void {
  for (const v of Object.values(m)) if ((v as Texture | null)?.isTexture) (v as Texture).dispose();
  const uniforms = (m as ShaderMaterial).uniforms;
  if (uniforms) for (const u of Object.values(uniforms)) if ((u.value as Texture | null)?.isTexture) (u.value as Texture).dispose();
  m.dispose();
}

function disposeScene(scene: Scene): void {
  scene.traverse((o) => {
    const mesh = o as Mesh;
    mesh.geometry?.dispose();
    const mat = mesh.material;
    if (Array.isArray(mat)) mat.forEach(disposeMaterial);
    else if (mat) disposeMaterial(mat);
  });
  const bg = scene.background as Texture | null;
  if (bg?.isTexture) bg.dispose();
}

export interface EngineOptions {
  canvas: HTMLCanvasElement;
  /** Element that gets data-tier and the is-ready class. */
  host: HTMLElement;
  mode: SceneMode;
  module: SceneModule;
  /** Full mode: the loop pauses while this element is out of view. */
  sentinel?: Element | null;
}

export class Engine {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  tier: Tier;
  private readonly forced: boolean;
  private readonly ctx: SceneContext;
  private readonly instance: SceneInstance;
  private readonly tracked: Disposable[] = [];
  private readonly reasons = new Set<PauseReason>();
  private readonly cleanups: Array<() => void> = [];
  private composer: EffectComposer | null = null;
  private raf = 0;
  private last = 0;
  private t = 0;
  private target = { x: 0, y: 0 };
  private fps = { frames: 0, time: 0, slow: 0 };
  private disposed = false;

  private constructor(private readonly opts: EngineOptions, renderer: WebGLRenderer, tier: { tier: Tier; forced: boolean }) {
    this.renderer = renderer;
    this.tier = tier.tier;
    this.forced = tier.forced;
    const { meta } = opts.module;
    const narrow = window.innerWidth < 700;
    this.camera = new PerspectiveCamera(narrow ? meta.camera.narrowFov : meta.camera.fov, 1, meta.camera.near, meta.camera.far);
    this.ctx = {
      scene: this.scene,
      camera: this.camera,
      renderer,
      rng: createRng(meta.seed),
      tier: this.tier,
      mode: opts.mode,
      glowGain: { value: 1 },
      pointer: { x: 0, y: 0 },
      narrow,
      maxAnisotropy: Math.min(8, renderer.capabilities.getMaxAnisotropy()),
      track: (item) => {
        this.tracked.push(item);
        return item;
      },
    };
    if (this.wantsBloom()) this.ctx.glowGain.value = BLOOM_GLOW_GAIN;
    this.instance = opts.module.create(this.ctx);
  }

  /** Returns null when WebGL is unavailable; the CSS fallback stays visible. */
  static async create(opts: EngineOptions): Promise<Engine | null> {
    const gl2 = !!document.createElement("canvas").getContext("webgl2");
    const tier = pickTier(gl2);
    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        canvas: opts.canvas,
        antialias: tier.tier !== "low",
        powerPreference: "high-performance",
      });
    } catch {
      return null;
    }
    renderer.outputColorSpace = LinearSRGBColorSpace;
    const engine = new Engine(opts, renderer, tier);
    await engine.init();
    return engine;
  }

  private wantsBloom(): boolean {
    return this.tier === "high" && this.opts.mode === "full";
  }

  private async init(): Promise<void> {
    const { host, mode, sentinel } = this.opts;
    host.dataset.tier = this.tier;
    if (this.wantsBloom()) await this.enableBloom();
    this.resize();

    const reduce = matchMedia("(prefers-reduced-motion: reduce)");
    if (reduce.matches) this.reasons.add("motion");
    if (readPaused()) this.reasons.add("user");
    if (document.hidden) this.reasons.add("hidden");

    this.listen(window, "resize", () => this.resize());
    this.listen(document, "visibilitychange", () => this.setReason("hidden", document.hidden));
    this.listen(reduce, "change", () => this.setReason("motion", reduce.matches));
    this.listen(window, PAUSE_EVENT, (e) => this.setReason("user", (e as CustomEvent<boolean>).detail));
    this.listen(window, "pagehide", (e) => {
      if (!(e as PageTransitionEvent).persisted) this.dispose();
    });
    if (mode === "full") {
      this.listen(window, "pointermove", (e) => {
        const p = e as PointerEvent;
        this.target.x = (p.clientX / window.innerWidth) * 2 - 1;
        this.target.y = (p.clientY / window.innerHeight) * 2 - 1;
      });
      if (sentinel && "IntersectionObserver" in window) {
        const io = new IntersectionObserver(([entry]) => this.setReason("offscreen", !entry?.isIntersecting));
        io.observe(sentinel);
        this.cleanups.push(() => io.disconnect());
      }
    }

    if (this.reasons.has("motion") || this.reasons.has("user")) this.renderStill();
    else this.renderFrame(0);
    host.classList.add("is-ready");
    this.sync();

    if (new URLSearchParams(location.search).has("debug-scenes")) (window as unknown as { __scene: Engine }).__scene = this;
  }

  private listen(target: EventTarget, type: string, fn: (e: Event) => void): void {
    target.addEventListener(type, fn, { passive: true });
    this.cleanups.push(() => target.removeEventListener(type, fn));
  }

  private async enableBloom(): Promise<void> {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/UnrealBloomPass.js"),
      import("three/addons/postprocessing/OutputPass.js"),
    ]);
    if (this.disposed) return;
    const { strength, radius, threshold } = this.opts.module.meta.bloom;
    const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    composer.addPass(new UnrealBloomPass(new Vector2(1, 1), strength, radius, threshold));
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  private setReason(reason: PauseReason, on: boolean): void {
    if (on) this.reasons.add(reason);
    else this.reasons.delete(reason);
    this.sync();
  }

  private sync(): void {
    if (this.disposed) return;
    const run = this.reasons.size === 0;
    if (run && !this.raf) {
      this.last = performance.now();
      this.fps = { frames: 0, time: 0, slow: 0 };
      this.raf = requestAnimationFrame(this.frame);
    } else if (!run && this.raf) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private readonly frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.renderFrame(dt);
    this.monitor(dt);
    if (this.opts.mode === "ambient" && this.t >= this.opts.module.meta.settleTime) this.setReason("frozen", true);
  };

  private renderFrame(dt: number): void {
    this.t += dt;
    const p = this.ctx.pointer;
    p.x += (this.target.x - p.x) * 0.04;
    p.y += (this.target.y - p.y) * 0.04;
    this.instance.update(dt, this.t);
    this.draw();
  }

  /** A settled frame: used for reduced motion and when paused at load. */
  private renderStill(): void {
    if (this.t < STILL_TIME) {
      this.t = STILL_TIME;
      this.instance.update(1 / 60, this.t);
    }
    this.instance.still?.();
    this.draw();
  }

  private draw(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  /** Drops a tier when a rolling average stays under 40 fps for 3 s. */
  private monitor(dt: number): void {
    if (this.forced || this.t < 2 || this.tier === "low") return;
    this.fps.frames++;
    this.fps.time += dt;
    if (this.fps.time < 1) return;
    const fps = this.fps.frames / this.fps.time;
    this.fps.frames = 0;
    this.fps.time = 0;
    this.fps.slow = fps < 40 ? this.fps.slow + 1 : 0;
    if (this.fps.slow >= 3) this.downgrade();
  }

  private downgrade(): void {
    const next = TIERS[TIERS.indexOf(this.tier) - 1];
    if (!next) return;
    this.tier = next;
    this.fps.slow = 0;
    storageSet(TIER_KEY, next);
    this.opts.host.dataset.tier = next;
    if (this.composer && !this.wantsBloom()) {
      this.composer.dispose();
      this.composer = null;
      this.ctx.glowGain.value = 1;
    }
    this.resize();
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = pixelRatio(this.tier, this.opts.mode);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.composer?.setPixelRatio(pr);
    this.composer?.setSize(w, h);
    const { camera } = this.opts.module.meta;
    this.camera.aspect = w / h;
    this.camera.fov = w < 700 ? camera.narrowFov : camera.fov;
    this.camera.updateProjectionMatrix();
    if (!this.raf) this.draw();
  }

  /** Debug: GPU resources still held. All zero after dispose(). */
  info(): { geometries: number; textures: number; calls: number; tier: Tier } {
    const { memory, render } = this.renderer.info;
    return { geometries: memory.geometries, textures: memory.textures, calls: render.calls, tier: this.tier };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const fn of this.cleanups) fn();
    this.instance.dispose();
    disposeScene(this.scene);
    for (const item of this.tracked) item.dispose();
    this.composer?.dispose();
    this.renderer.dispose();
  }
}
