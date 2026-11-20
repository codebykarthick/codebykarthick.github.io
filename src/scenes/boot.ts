import { Engine } from "./engine";
import { READY_EVENT } from "./prefs";
import { SCENES } from "./registry";
import type { SceneId, SceneMode } from "./types";

/** Loaded after first paint by SceneHost. Starts the page's scene behind the content. */
export async function boot(host: HTMLElement): Promise<void> {
  const id = host.dataset.scene as SceneId | undefined;
  const mode = (host.dataset.mode ?? "full") as SceneMode;
  const canvas = host.querySelector("canvas");
  const load = id ? SCENES[id] : undefined;
  if (!canvas || !load) return;
  const module = await load();
  const engine = await Engine.create({
    canvas,
    host,
    mode,
    module,
    sentinel: document.querySelector("[data-scene-sentinel]"),
  });
  if (engine) window.dispatchEvent(new Event(READY_EVENT));
}
