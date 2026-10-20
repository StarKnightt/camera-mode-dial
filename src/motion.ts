export const MODE_COUNT = 5;
export const STEP = (Math.PI * 2) / MODE_COUNT;

export const MODE_NAMES = [
  "manual",
  "aperture priority",
  "shutter priority",
  "program",
  "auto",
] as const;

export function wrapAngle(a: number): number {
  const t = STEP * MODE_COUNT;
  a = a % t;
  return a < 0 ? a + t : a;
}

export function modeIndex(angle: number): number {
  const m = Math.round(angle / STEP);
  return ((m % MODE_COUNT) + MODE_COUNT) % MODE_COUNT;
}

/** Underdamped settle on 0..1 with one small overshoot and no second bounce. */
function settleEase(u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const zeta = 0.66;
  const wn = 7.4;
  const wd = wn * Math.sqrt(1 - zeta * zeta);
  const e = Math.exp(-zeta * wn * u);
  const y = 1 - e * (Math.cos(wd * u) + ((zeta * wn) / wd) * Math.sin(wd * u));
  return u > 0.92 ? y + (1 - y) * ((u - 0.92) / 0.08) : y;
}

const KEYS: { t: number; turns: number }[] = [
  { t: 0, turns: 1 },
  { t: 1.35, turns: 1 },
  { t: 2.9, turns: 2 },
  { t: 4.45, turns: 3 },
  { t: 6.0, turns: 4 },
  { t: 7.7, turns: 5 },
  { t: 11.15, turns: 5 },
  { t: 12.55, turns: 9 },
  { t: 15, turns: 9 },
];

export const DEMO_SECONDS = 15;

export function demoAngle(time: number): number {
  const t = Math.max(0, Math.min(DEMO_SECONDS, time));
  let i = 0;
  while (i < KEYS.length - 2 && t > KEYS[i + 1].t) i++;
  const a = KEYS[i];
  const b = KEYS[i + 1];
  const u = (t - a.t) / Math.max(1e-4, b.t - a.t);
  const turns = a.turns + (b.turns - a.turns) * settleEase(u);
  return turns * STEP;
}

export interface ClickEvent {
  t: number;
  auto: boolean;
}

export function demoClicks(): ClickEvent[] {
  const clicks: ClickEvent[] = [];
  let prev = modeIndex(demoAngle(0));
  const dt = 1 / 2000;
  for (let t = dt; t <= DEMO_SECONDS; t += dt) {
    const mode = modeIndex(demoAngle(t));
    if (mode !== prev) {
      clicks.push({ t, auto: mode === 4 });
      prev = mode;
    }
  }
  return clicks;
}

/**
 * Heavy detent. While held, the knob lags the finger and a well pulls it
 * back. On release it travels with inertia, overshoots the notch once,
 * then switches to overdamped so it cannot ring.
 */
export class DialSim {
  angle = 0;
  velocity = 0;
  dragging = false;
  private lock: number | null = null;
  private passed = false;

  drag(dPhi: number, dt: number): void {
    this.dragging = true;
    this.lock = null;
    this.passed = false;
    const push = -dPhi * 0.62;
    this.angle += push;
    this.velocity = push / Math.max(dt, 1 / 240);
  }

  release(): void {
    if (!this.dragging) return;
    this.dragging = false;
    this.lock = Math.round(this.angle / STEP) * STEP;
    this.passed = false;
  }

  wheel(dir: number): void {
    this.dragging = false;
    this.passed = false;
    this.lock = Math.round(this.angle / STEP) * STEP + Math.sign(dir || 1) * STEP;
    this.velocity += Math.sign(dir || 1) * 2.4;
  }

  step(dt: number): { clicked: boolean; auto: boolean } {
    const before = modeIndex(this.angle);
    const h = Math.min(dt, 1 / 20);

    if (this.dragging) {
      const well = Math.round(this.angle / STEP) * STEP;
      const err = well - this.angle;
      const t = Math.min(1, Math.abs(err) / (STEP * 0.5));
      this.angle += err * (1 - t * t) * 5 * h;
      this.velocity *= Math.exp(-2.5 * h);
    } else if (this.lock !== null) {
      const ahead = this.lock + Math.sign(this.velocity || 0) * STEP;
      if (
        Math.abs(this.velocity) > 2.1 &&
        Math.abs(ahead - this.angle) < Math.abs(this.lock - this.angle)
      ) {
        this.lock = ahead;
        this.passed = false;
      }
      const err = this.lock - this.angle;
      const zeta = this.passed ? 1.35 : 0.64;
      const wn = this.passed ? 52 : 38;
      const acc = wn * wn * err - 2 * zeta * wn * this.velocity;
      this.velocity += acc * h;
      this.angle += this.velocity * h;
      const err2 = this.lock - this.angle;
      if (!this.passed && err * err2 < 0) this.passed = true;
      if (Math.abs(err2) < 0.0004 && Math.abs(this.velocity) < 0.02) {
        this.angle = this.lock;
        this.velocity = 0;
      }
    }

    const mode = modeIndex(this.angle);
    const clicked = mode !== before;
    return { clicked, auto: mode === 4 };
  }
}
