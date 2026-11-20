/** Scene preferences shared by the engine and the page UI. No three.js imports here. */
export const TIER_KEY = "scenes:tier";
export const PAUSE_KEY = "scenes:paused";
/** window CustomEvent<boolean>: true = paused. Dispatched by the site-wide toggle. */
export const PAUSE_EVENT = "scenes:pause";
/** window Event: a scene is running and animatable. */
export const READY_EVENT = "scenes:ready";

export function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* private mode or blocked storage: the preference just isn't remembered */
  }
}

export function readPaused(): boolean {
  return storageGet(PAUSE_KEY) === "1";
}
