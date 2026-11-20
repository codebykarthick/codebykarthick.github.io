import { BoxGeometry, EdgesGeometry } from "three";
import type { Rng } from "../types";

export interface BuildingUv {
  /** World units covered by one texture tile, [across, up]. Default [12, 24] (window grid). */
  tile?: readonly [number, number];
  /** Shift each building's texture by a random eighth so neighbours don't line up. Default true. */
  jitter?: boolean;
}

/**
 * Box with the PoC's UV tiling: one texture tile per `tile` units on the sides,
 * a dark texel on the top and bottom. The geometry is already positioned
 * (base at y0), ready for StaticBatch.
 */
export function buildingGeometry(rng: Rng, x: number, z: number, w: number, d: number, h: number, y0 = 0, uvOpts: BuildingUv = {}): BoxGeometry {
  const [tw, th] = uvOpts.tile ?? [12, 24];
  const geo = new BoxGeometry(w, h, d);
  const uv = geo.getAttribute("uv");
  const off = (uvOpts.jitter ?? true) ? Math.floor(rng.next() * 8) / 8 : 0;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < 4; k++) {
      const i = f * 4 + k;
      if (f === 2 || f === 3) {
        uv.setXY(i, 0.005, 0.005);
        continue;
      }
      const span = f < 2 ? d : w;
      uv.setXY(i, off + (uv.getX(i) * span) / tw, (uv.getY(i) * h) / th);
    }
  }
  uv.needsUpdate = true;
  geo.translate(x, y0 + h / 2, z);
  return geo;
}

export function boxEdges(x: number, y: number, z: number, w: number, h: number, d: number): EdgesGeometry {
  const box = new BoxGeometry(w, h, d);
  const edges = new EdgesGeometry(box);
  box.dispose();
  edges.translate(x, y, z);
  return edges;
}

/** Facade at the street edge, used to hang signs. */
export interface Frontage {
  side: -1 | 1;
  /** Distance from the road centre to the facade. */
  x: number;
  w: number;
  zc: number;
  d: number;
  h: number;
}
