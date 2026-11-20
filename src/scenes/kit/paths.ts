/** A 3D polyline you can sample by distance. Used for metro lines and anything that follows a route. */
export class Polyline {
  readonly length: number;
  private readonly cum: number[] = [0];

  constructor(readonly points: ReadonlyArray<readonly [number, number, number]>) {
    let total = 0;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay, az] = points[i - 1]!;
      const [bx, by, bz] = points[i]!;
      total += Math.hypot(bx - ax, by - ay, bz - az);
      this.cum.push(total);
    }
    this.length = total;
  }

  /** Writes the point at distance s (clamped to the line) into out. */
  at(s: number, out: { x: number; y: number; z: number }): void {
    const d = Math.max(0, Math.min(this.length, s));
    let i = 1;
    while (i < this.cum.length - 1 && this.cum[i]! < d) i++;
    const s0 = this.cum[i - 1]!, s1 = this.cum[i]!;
    const k = s1 > s0 ? (d - s0) / (s1 - s0) : 0;
    const a = this.points[i - 1]!, b = this.points[i]!;
    out.x = a[0] + (b[0] - a[0]) * k;
    out.y = a[1] + (b[1] - a[1]) * k;
    out.z = a[2] + (b[2] - a[2]) * k;
  }

  /** Consecutive segments as [start, end] pairs. */
  segments(): Array<[readonly [number, number, number], readonly [number, number, number]]> {
    const out: Array<[readonly [number, number, number], readonly [number, number, number]]> = [];
    for (let i = 1; i < this.points.length; i++) out.push([this.points[i - 1]!, this.points[i]!]);
    return out;
  }
}

/**
 * Metro-map routing on the ground plane: from each stop to the next, a 45° run
 * then a straight run, so every segment is orthogonal or diagonal.
 */
export function octilinear(stops: ReadonlyArray<readonly [number, number]>, y: number): Array<[number, number, number]> {
  const pts: Array<[number, number, number]> = [];
  for (let i = 0; i < stops.length; i++) {
    const [bx, bz] = stops[i]!;
    if (i > 0) {
      const [ax, az] = stops[i - 1]!;
      const dx = bx - ax, dz = bz - az;
      const m = Math.min(Math.abs(dx), Math.abs(dz));
      if (m > 0.01 && Math.abs(Math.abs(dx) - Math.abs(dz)) > 0.01) pts.push([ax + Math.sign(dx) * m, y, az + Math.sign(dz) * m]);
    }
    pts.push([bx, y, bz]);
  }
  return pts;
}
