/** Signed-distance engraving for M A S P U T O. Origin at the letter center, y up, unit cap height. */

export type Sdf = (x: number, y: number) => number;

function sdSegment(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): number {
  const vx = bx - ax;
  const vy = by - ay;
  const l2 = vx * vx + vy * vy;
  const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * vx + (py - ay) * vy) / l2)) : 0;
  return Math.hypot(px - (ax + t * vx), py - (ay + t * vy));
}

function sdStroke(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  radius: number,
): number {
  return sdSegment(px, py, ax, ay, bx, by) - radius;
}

function sdRing(px: number, py: number, radius: number, thickness: number): number {
  return Math.abs(Math.hypot(px, py) - radius) - thickness;
}

function sdRoundBox(
  px: number,
  py: number,
  hx: number,
  hy: number,
  radius: number,
): number {
  const qx = Math.abs(px) - hx;
  const qy = Math.abs(py) - hy;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  );
}

function union(a: number, b: number): number {
  return Math.min(a, b);
}

function subtract(a: number, b: number): number {
  return Math.max(a, -b);
}

function bezier(
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  t: number,
): [number, number] {
  const u = 1 - t;
  const x =
    u * u * u * p0[0] +
    3 * u * u * t * p1[0] +
    3 * u * t * t * p2[0] +
    t * t * t * p3[0];
  const y =
    u * u * u * p0[1] +
    3 * u * u * t * p1[1] +
    3 * u * t * t * p2[1] +
    t * t * t * p3[1];
  return [x, y];
}

function sdBezierStroke(
  px: number,
  py: number,
  p0: readonly [number, number],
  p1: readonly [number, number],
  p2: readonly [number, number],
  p3: readonly [number, number],
  radius: number,
): number {
  let best = Infinity;
  let prev = p0;
  for (let i = 1; i <= 18; i++) {
    const next = bezier(p0, p1, p2, p3, i / 18);
    best = Math.min(best, sdSegment(px, py, prev[0], prev[1], next[0], next[1]));
    prev = next;
  }
  return best - radius;
}

/** Geometric grotesque, medium weight, similar to engraved camera-dial caps. */
export const GLYPHS: Record<string, Sdf> = {
  M: (x, y) => {
    const stem = 0.075;
    const left = sdStroke(x, y, -0.34, -0.48, -0.34, 0.48, stem);
    const right = sdStroke(x, y, 0.34, -0.48, 0.34, 0.48, stem);
    const v = union(
      sdStroke(x, y, -0.34, 0.46, 0, -0.02, stem * 0.92),
      sdStroke(x, y, 0.34, 0.46, 0, -0.02, stem * 0.92),
    );
    return union(union(left, right), v);
  },
  A: (x, y) => {
    const stem = 0.09;
    const left = sdStroke(x, y, -0.3, -0.48, 0, 0.5, stem);
    const right = sdStroke(x, y, 0.3, -0.48, 0, 0.5, stem);
    const bar = sdStroke(x, y, -0.16, -0.06, 0.16, -0.06, stem * 0.85);
    return union(union(left, right), bar);
  },
  S: (x, y) => {
    const r = 0.068;
    const top = sdBezierStroke(
      x,
      y,
      [0.28, 0.18],
      [0.32, 0.52],
      [-0.34, 0.5],
      [-0.22, 0.12],
      r,
    );
    const bot = sdBezierStroke(
      x,
      y,
      [-0.22, 0.12],
      [-0.08, -0.22],
      [0.36, -0.18],
      [-0.3, -0.5],
      r,
    );
    return union(top, bot);
  },
  P: (x, y) => {
    const stem = sdStroke(x, y, -0.16, -0.48, -0.16, 0.46, 0.07);
    const top = sdStroke(x, y, -0.16, 0.4, 0.12, 0.4, 0.065);
    const mid = sdStroke(x, y, -0.16, 0.02, 0.1, 0.02, 0.065);
    const side = sdStroke(x, y, 0.16, 0.08, 0.16, 0.34, 0.065);
    const upper = sdBezierStroke(x, y, [0.08, 0.4], [0.34, 0.4], [0.34, 0.22], [0.12, 0.22], 0.06);
    const lower = sdBezierStroke(x, y, [0.12, 0.2], [0.32, 0.2], [0.32, 0.02], [0.06, 0.02], 0.06);
    return union(union(union(stem, top), union(mid, side)), union(upper, lower));
  },
  U: (x, y) => {
    const r = 0.07;
    const left = sdStroke(x, y, -0.24, 0.48, -0.24, -0.12, r);
    const right = sdStroke(x, y, 0.24, 0.48, 0.24, -0.12, r);
    const bowl = sdBezierStroke(
      x,
      y,
      [-0.24, -0.12],
      [-0.24, -0.55],
      [0.24, -0.55],
      [0.24, -0.12],
      r,
    );
    return union(union(left, right), bowl);
  },
  T: (x, y) => {
    const bar = sdStroke(x, y, -0.3, 0.42, 0.3, 0.42, 0.07);
    const stem = sdStroke(x, y, 0, 0.42, 0, -0.48, 0.068);
    return union(bar, stem);
  },
  O: (x, y) => sdRing(x, y, 0.3, 0.07),
};

export interface PlacedMark {
  glyph: Sdf;
  /** Clockwise from the index when the dial rotation is 0. */
  angle: number;
  radius: number;
  scale: number;
  /** Shift along the tangent, in world units, before scaling the glyph. */
  slide: number;
}

export function sampleMark(mark: PlacedMark, x: number, z: number): number {
  const ox = Math.sin(mark.angle) * mark.radius + Math.cos(mark.angle) * mark.slide;
  const oz = -Math.cos(mark.angle) * mark.radius + Math.sin(mark.angle) * mark.slide;
  const rightX = Math.cos(mark.angle);
  const rightZ = Math.sin(mark.angle);
  const upX = Math.sin(mark.angle);
  const upZ = -Math.cos(mark.angle);
  const dx = x - ox;
  const dz = z - oz;
  const lx = dx * rightX + dz * rightZ;
  const ly = dx * upX + dz * upZ;
  return mark.glyph(lx / mark.scale, ly / mark.scale) * mark.scale;
}

export function minSdf(marks: PlacedMark[], x: number, z: number): number {
  let d = 1e6;
  for (const mark of marks) d = Math.min(d, sampleMark(mark, x, z));
  return d;
}
