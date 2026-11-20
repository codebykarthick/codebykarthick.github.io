import { CanvasTexture } from "three";

export function makeCanvas(w: number, h: number): { canvas: HTMLCanvasElement; g: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("2D canvas unavailable");
  return { canvas, g };
}

export function canvasTexture(canvas: HTMLCanvasElement): CanvasTexture {
  return new CanvasTexture(canvas);
}
