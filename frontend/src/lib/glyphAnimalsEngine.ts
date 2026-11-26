export type SpeciesKey =
  | "moths"
  | "rabbits"
  | "turtles"
  | "squid"
  | "owls"
  | "flyingfish"
  | "eagles";

export interface AtmosphereTweaks {
  density: number;
  cornerToCorner: boolean;
  direction: number;
  speed: number;
  sway: number;
  spread: number;
  size: number;
  farthest: number;
  farBias: number;
  grip: number;
  separation: number;
  hue: number;
  shimmer: number;
  sparkle: number;
  fog: number;
  trail: number;
  trailFade: number;
  grid: number;
  detail: number;
  // Species-specific motion / appearance controls
  flutter: number;
  glide: number;
  flapRate: number;
  burst: number;
  pause: number;
  hopSpeed: number;
  scare: number;
  meander: number;
  flipperBeat: number;
  foodRange: number;
  pulseRate: number;
  pulsePower: number;
  pulseGlow: number;
  armLength: number;
  hoverTime: number;
  cruising: number;
  swoopSpeed: number;
  wingbeat: number;
  howOften: number;
  leapLength: number;
  leapHeight: number;
  foldingFlap: boolean;
  // Glass tokens for Home chrome & composer
  blur: number;
  refraction: number;
  ripple: number;
  tint: number;
  edge: number;
  composerRadius: number;
  composerWidth: number;
}

export interface SpeciesMeta {
  key: SpeciesKey;
  label: string;
  dotColor: string;
  scale: number;
  area: number;
  baseSpeed: number;
  trailColor: readonly [number, number, number];
  defaults: AtmosphereTweaks;
}

const BASE_DEFAULTS: AtmosphereTweaks = {
  density: 1,
  cornerToCorner: false,
  direction: 49,
  speed: 1,
  sway: 0.04,
  spread: 0.06,
  size: 1,
  farthest: 0.45,
  farBias: 1.6,
  grip: 2,
  separation: 300,
  hue: 0,
  shimmer: 0.3,
  sparkle: 0.12,
  fog: 0.75,
  trail: 1,
  trailFade: 1.3,
  grid: 1.05,
  detail: 1.3,
  flutter: 0,
  glide: 2.75,
  flapRate: 1,
  burst: 1,
  pause: 1,
  hopSpeed: 1,
  scare: 0.6,
  meander: 0.4,
  flipperBeat: 1,
  foodRange: 200,
  pulseRate: 1,
  pulsePower: 1,
  pulseGlow: 1,
  armLength: 1,
  hoverTime: 1.3,
  cruising: 0.5,
  swoopSpeed: 1.3,
  wingbeat: 1,
  howOften: 1,
  leapLength: 0.6,
  leapHeight: 1,
  foldingFlap: false,
  blur: 3.5,
  refraction: 40,
  ripple: 0.007,
  tint: 0,
  edge: 0.55,
  composerRadius: 24,
  composerWidth: 720,
};

function makeDefaults(
  overrides: Partial<AtmosphereTweaks>
): AtmosphereTweaks {
  return { ...BASE_DEFAULTS, ...overrides };
}

export const SPECIES_LIST: SpeciesMeta[] = [
  {
    key: "moths",
    label: "Moth",
    dotColor: "rgb(232, 162, 124)",
    scale: 1,
    area: 48000,
    baseSpeed: 90,
    trailColor: [255, 196, 156],
    defaults: makeDefaults({
      direction: 49,
      density: 1.05,
      speed: 1.05,
      sway: 0,
      spread: 0,
      size: 1.25,
      farthest: 0.18,
      farBias: 1.7,
      grip: 5,
      separation: 700,
      trail: 1.55,
      trailFade: 0.15,
      flutter: 0,
      glide: 2.75,
      flapRate: 1,
    }),
  },
  {
    key: "rabbits",
    label: "Rabbit",
    dotColor: "rgb(248, 199, 181)",
    scale: 1.15,
    area: 80000,
    baseSpeed: 95,
    trailColor: [226, 190, 168],
    defaults: makeDefaults({
      direction: 0,
      detail: 1.7,
      fog: 0.12,
      density: 1.6,
      sway: 0,
      spread: 0,
      farthest: 0.3,
      farBias: 0.8,
      grip: 3,
      separation: 420,
      trail: 1.2,
      trailFade: 0.35,
      shimmer: 0.1,
      sparkle: 0.03,
      burst: 1,
      pause: 1,
      hopSpeed: 1,
      scare: 0.6,
    }),
  },
  {
    key: "turtles",
    label: "Sea turtle",
    dotColor: "rgb(109, 176, 138)",
    scale: 1.6,
    area: 110000,
    baseSpeed: 46,
    trailColor: [110, 200, 186],
    defaults: makeDefaults({
      direction: 49,
      fog: 0.64,
      density: 1.4,
      speed: 1.4,
      spread: 0,
      sway: 0,
      farthest: 0.33,
      farBias: 1.3,
      grip: 2.65,
      separation: 780,
      trail: 3,
      trailFade: 0.4,
      shimmer: 0.35,
      sparkle: 0.08,
      meander: 0.4,
      flipperBeat: 1,
      foodRange: 200,
    }),
  },
  {
    key: "squid",
    label: "Squid",
    dotColor: "rgb(232, 106, 160)",
    scale: 1.55,
    area: 95000,
    baseSpeed: 55,
    trailColor: [255, 140, 196],
    defaults: makeDefaults({
      direction: 131,
      speed: 1.05,
      sway: 0.04,
      spread: 0.08,
      farthest: 0.3,
      farBias: 1.4,
      grip: 1.4,
      trail: 0.8,
      trailFade: 0.6,
      sparkle: 0.1,
      pulseRate: 1,
      pulsePower: 1,
      pulseGlow: 1,
      armLength: 1,
    }),
  },
  {
    key: "owls",
    label: "Owl",
    dotColor: "rgb(217, 195, 160)",
    scale: 2.1,
    area: 130000,
    baseSpeed: 70,
    trailColor: [236, 212, 170],
    defaults: makeDefaults({
      direction: 49,
      fog: 0.26,
      density: 1.5,
      sway: 0,
      spread: 0,
      farthest: 0.32,
      farBias: 2.4,
      grip: 5,
      separation: 720,
      trail: 0.6,
      trailFade: 1.2,
      sparkle: 0.08,
      hoverTime: 1.3,
      cruising: 0.5,
      swoopSpeed: 1.3,
      wingbeat: 1,
    }),
  },
  {
    key: "flyingfish",
    label: "Flying fish",
    dotColor: "rgb(133, 227, 221)",
    scale: 1.25,
    area: 85000,
    baseSpeed: 80,
    trailColor: [120, 214, 226],
    defaults: makeDefaults({
      direction: 131,
      fog: 0,
      size: 1.2,
      density: 1.3,
      sway: 0,
      spread: 0,
      farthest: 0.35,
      farBias: 1.4,
      separation: 450,
      trail: 3.45,
      trailFade: 0.4,
      shimmer: 0.25,
      sparkle: 0.1,
      howOften: 1,
      leapLength: 0.6,
      leapHeight: 1,
    }),
  },
  {
    key: "eagles",
    label: "Eagle",
    dotColor: "rgb(230, 233, 242)",
    scale: 1.5,
    area: 60000,
    baseSpeed: 82,
    trailColor: [200, 204, 226],
    defaults: makeDefaults({
      direction: 49,
      detail: 1.7,
      density: 0.75,
      speed: 1.4,
      sway: 0,
      spread: 0,
      farthest: 0.35,
      farBias: 1.3,
      grip: 3,
      separation: 150,
      trail: 0,
      shimmer: 0.1,
      sparkle: 0.04,
      wingbeat: 0.85,
      glide: 1.6,
      foldingFlap: false,
    }),
  },
];

export const SPECIES_MAP: Record<SpeciesKey, SpeciesMeta> = {
  moths: SPECIES_LIST[0],
  rabbits: SPECIES_LIST[1],
  turtles: SPECIES_LIST[2],
  squid: SPECIES_LIST[3],
  owls: SPECIES_LIST[4],
  flyingfish: SPECIES_LIST[5],
  eagles: SPECIES_LIST[6],
};

type RGB = readonly [number, number, number];
type CellKind =
  | "Plain"
  | "Shine"
  | "Dark"
  | "Light"
  | "Fur"
  | "Soft"
  | "Bright"
  | "Line";

interface ShapeSample {
  color: RGB;
  kind: CellKind;
  glyphs?: string;
}

interface GridCell {
  solid: boolean;
  fill: string;
  glyph: string;
  glyphColor: string;
}

interface FoodPellet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  maxAge: number;
}

interface MarineSnow {
  x: number;
  y: number;
  speed: number;
  phase: number;
  star: boolean;
}

interface Animal {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  heading: number;
  roll: number;
  depth: number;
  span: number;
  bias: number;
  phase: number;
  pace: number;
  startleTimer: number;
  alarm: number;
  // Moth / Eagle glide
  glide: number;
  glideGoal: number;
  glideTimer: number;
  // Rabbit burst/pause
  resting: boolean;
  stateTimer: number;
  // Owl 3-state
  owlState: "hover" | "swoop" | "cruise";
  tuck: number;
  aimOffset: number;
  // Flying fish
  leaping: boolean;
  leapStartX: number;
  leapStartY: number;
  leapTargetX: number;
  leapTargetY: number;
  leapDuration: number;
  leapProgress: number;
  leapPower: number;
  // Squid turn bend
  turnRate: number;
  // Sea turtle prev flipper
  lastFlipperSin: number;
}

const BG_RGB: RGB = [6, 7, 12];
const RAMP_PLAIN = ".:;+=*%#";
const RAMP_LINE = ".:+*";
const SPARKLE_COLORS = ["#ffffff", "#dceeff", "#d4ffff"] as const;

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

function mixRgb(a: RGB, b: RGB, t: number): RGB {
  const k = clamp(t, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * k,
    a[1] + (b[1] - a[1]) * k,
    a[2] + (b[2] - a[2]) * k,
  ];
}

function hashInt(n: number): number {
  let x = n | 0;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = ((x >>> 16) ^ x) * 0x45d9f3b;
  x = (x >>> 16) ^ x;
  return (x >>> 0) / 4294967296;
}

function hash2d(seed: number, a: number, b: number): number {
  return hashInt(seed * 73856093 + a * 19349663 + b * 83492791);
}

function rgbStr(c: RGB): string {
  return `rgb(${clamp(Math.round(c[0]), 0, 255)},${clamp(Math.round(c[1]), 0, 255)},${clamp(Math.round(c[2]), 0, 255)})`;
}

function rotateHue(c: RGB, deg: number): RGB {
  if (Math.abs(deg) < 0.01) return c;
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const r = c[0];
  const g = c[1];
  const b = c[2];
  // Standard luminance-preserving hue rotation matrix
  const nr =
    r * (0.213 + 0.787 * cos - 0.213 * sin) +
    g * (0.715 - 0.715 * cos - 0.715 * sin) +
    b * (0.072 - 0.072 * cos + 0.928 * sin);
  const ng =
    r * (0.213 - 0.213 * cos + 0.143 * sin) +
    g * (0.715 + 0.285 * cos + 0.140 * sin) +
    b * (0.072 - 0.072 * cos - 0.283 * sin);
  const nb =
    r * (0.213 - 0.213 * cos - 0.787 * sin) +
    g * (0.715 - 0.715 * cos + 0.715 * sin) +
    b * (0.072 + 0.928 * cos + 0.072 * sin);
  return [clamp(nr, 0, 255), clamp(ng, 0, 255), clamp(nb, 0, 255)];
}

function wrapAngle(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}

function turnToward(current: number, target: number, maxStep: number): number {
  const diff = wrapAngle(target - current);
  if (Math.abs(diff) <= maxStep) return target;
  return wrapAngle(current + Math.sign(diff) * maxStep);
}

function polarLobe(
  u: number,
  v: number,
  pivotU: number,
  minAngle: number,
  maxAngle: number,
  reach: number,
  peakPos: number,
  roundness: number,
  opening: number,
  scallop = 0
): number | null {
  const av = Math.abs(v) / Math.max(0.12, opening);
  if (av < 0.01 && Math.abs(u - pivotU) < 0.01) return 0;
  const ang = Math.atan2(u - pivotU, av);
  if (ang < minAngle || ang > maxAngle) return null;
  const s = (ang - minAngle) / (maxAngle - minAngle);
  const bell =
    s < peakPos
      ? Math.pow(s / peakPos, 0.7 + roundness * 0.6)
      : Math.pow((1 - s) / Math.max(0.01, 1 - peakPos), 0.7 + roundness * 0.7);
  const wave = scallop ? 1 - scallop * (0.5 - 0.5 * Math.cos(s * Math.PI * 8)) : 1;
  const maxR = reach * clamp(bell, 0.05, 1) * wave;
  const dist = Math.hypot(u - pivotU, av);
  if (dist > maxR) return null;
  return dist / Math.max(0.01, maxR);
}

function inEllipse(
  u: number,
  v: number,
  cu: number,
  cv: number,
  ru: number,
  rv: number
): number | null {
  const du = (u - cu) / ru;
  const dv = (v - cv) / rv;
  const d2 = du * du + dv * dv;
  if (d2 > 1) return null;
  return Math.sqrt(d2);
}

export class GlyphAnimalsEngine {
  private species: SpeciesKey = "moths";
  private tweaks: AtmosphereTweaks = { ...SPECIES_MAP.moths.defaults };
  private width = 1440;
  private height = 900;
  private cw = 9;
  private ch = 13;
  private cols = 160;
  private rows = 69;

  private animals: Animal[] = [];
  private pellets: FoodPellet[] = [];
  private marineSnow: MarineSnow[] = [];
  private trailField = new Float32Array(0);
  private trailNext = new Float32Array(0);
  private cellGrid: Array<GridCell | null> = [];

  private bgCanvas: HTMLCanvasElement | null = null;
  private bgDirty = true;

  private nextId = 1;
  private simTime = 0;
  private fontFamily = '"Geist Mono", ui-monospace, Menlo, monospace';
  private reducedMotion = false;
  private forcedCount: number | null = null;

  constructor(
    initialSpecies: SpeciesKey = "moths",
    initialTweaks?: Partial<AtmosphereTweaks>
  ) {
    this.species = initialSpecies;
    this.tweaks = { ...SPECIES_MAP[initialSpecies].defaults, ...initialTweaks };
    if (typeof document !== "undefined") {
      this.bgCanvas = document.createElement("canvas");
    }
  }

  public setFontFamily(font: string): void {
    this.fontFamily = font || '"Geist Mono", ui-monospace, Menlo, monospace';
  }

  public setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  public setForcedCount(count: number | null): void {
    this.forcedCount =
      count !== null && Number.isFinite(count) && count >= 1
        ? clamp(Math.round(count), 1, 200)
        : null;
    this.syncPopulation(false);
  }

  public getSpecies(): SpeciesKey {
    return this.species;
  }

  public getTweaks(): AtmosphereTweaks {
    return { ...this.tweaks };
  }

  public setSpecies(
    next: SpeciesKey,
    overrideTweaks?: Partial<AtmosphereTweaks>
  ): void {
    this.species = next;
    this.tweaks = { ...SPECIES_MAP[next].defaults, ...overrideTweaks };
    this.trailField.fill(0);
    this.pellets = [];
    this.animals = [];
    this.bgDirty = true;
    this.recomputeGrid();
    this.syncPopulation(true);
    this.syncMarineSnow();
  }

  public updateTweaks(partial: Partial<AtmosphereTweaks>): void {
    const prevDetail = this.tweaks.detail;
    const prevGrid = this.tweaks.grid;
    const prevHue = this.tweaks.hue;
    this.tweaks = { ...this.tweaks, ...partial };
    if (Math.abs(this.tweaks.detail - prevDetail) > 0.001) {
      this.recomputeGrid();
    }
    if (
      Math.abs(this.tweaks.grid - prevGrid) > 0.001 ||
      Math.abs(this.tweaks.hue - prevHue) > 0.01
    ) {
      this.bgDirty = true;
    }
    this.syncPopulation(false);
  }

  public resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.recomputeGrid();
    this.syncPopulation(this.animals.length === 0);
    this.syncMarineSnow();
  }

  public simulateSettledStill(): void {
    this.animals = [];
    this.trailField.fill(0);
    this.syncPopulation(true);
    this.syncMarineSnow();
    const dt = 1 / 60;
    for (let i = 0; i < 240; i++) {
      this.step(dt);
    }
  }

  public tap(x: number, y: number): void {
    if (this.reducedMotion) return;
    if (this.species === "turtles") {
      const count = 7 + Math.floor(Math.random() * 5);
      for (let i = 0; i < count; i++) {
        if (this.pellets.length >= 60) this.pellets.shift();
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * 70;
        const spd = 4 + Math.random() * 10;
        const px = x + Math.cos(a) * r;
        const py = y + Math.sin(a) * r;
        this.pellets.push({
          x: px,
          y: py,
          vx: Math.cos(a) * spd,
          vy: Math.sin(a) * spd,
          age: 0,
          maxAge: 14,
        });
        this.stampTrail(px, py, 1, 0.7);
      }
      return;
    }

    this.stampTrail(x, y, 6, 1.4);

    for (const a of this.animals) {
      const dx = a.x - x;
      const dy = a.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > 240) continue;
      const k = 1 - dist / 240;
      const awayAngle = dist > 1 ? Math.atan2(dy, dx) : Math.random() * Math.PI * 2;

      if (this.species === "moths") {
        const kick = k * 420 * a.depth;
        a.vx += Math.cos(awayAngle) * kick;
        a.vy += Math.sin(awayAngle) * kick;
        a.startleTimer = 0.6 + Math.random() * 0.6;
        a.glide = 0;
        a.glideGoal = 0;
      } else if (this.species === "rabbits") {
        const scare = this.tweaks.scare;
        if (scare > 0) {
          const fleeAngle = awayAngle + (Math.random() - 0.5) * 0.7;
          const cruise = this.getCruise(a);
          const fleeSpeed = cruise * (2.5 + 3 * k) * scare;
          a.vx = Math.cos(fleeAngle) * fleeSpeed;
          a.vy = Math.sin(fleeAngle) * fleeSpeed;
          a.resting = false;
          a.startleTimer = (1 + 1.5 * k) * Math.sqrt(scare);
          a.alarm = 1;
        }
      } else if (this.species === "squid") {
        a.phase = 0;
        const kick = 260 * k * a.depth;
        a.vx += Math.cos(a.heading) * kick;
        a.vy += Math.sin(a.heading) * kick;
      } else if (this.species === "owls") {
        a.owlState = "swoop";
        a.stateTimer = 0.25 + 0.3 * k;
        a.tuck = 1;
      } else if (this.species === "flyingfish") {
        if (!a.leaping) {
          this.startFishLeap(a, awayAngle, 1 + k);
        }
      } else if (this.species === "eagles") {
        const push = k * 240 * a.depth;
        a.vx += Math.cos(awayAngle) * push;
        a.vy += Math.sin(awayAngle) * push;
        a.startleTimer = 0.7;
      }
    }
  }

  private recomputeGrid(): void {
    const cw = clamp(
      Math.round(this.width / 124 / Math.max(0.5, this.tweaks.detail)),
      5,
      24
    );
    const ch = Math.round(cw * 1.45);
    if (
      cw !== this.cw ||
      ch !== this.ch ||
      Math.ceil(this.width / cw) !== this.cols ||
      Math.ceil(this.height / ch) !== this.rows
    ) {
      this.cw = cw;
      this.ch = ch;
      this.cols = Math.max(1, Math.ceil(this.width / cw));
      this.rows = Math.max(1, Math.ceil(this.height / ch));
      const len = this.cols * this.rows;
      this.trailField = new Float32Array(len);
      this.trailNext = new Float32Array(len);
      this.cellGrid = new Array<GridCell | null>(len).fill(null);
      this.bgDirty = true;
    }
  }

  private getBaseSize(): number {
    const meta = SPECIES_MAP[this.species];
    return clamp(Math.min(this.width, this.height) * 0.2, 80, 190) * meta.scale;
  }

  private getCourseRad(): number {
    if (this.tweaks.cornerToCorner) {
      return Math.atan2(-this.height, this.width);
    }
    // 0 = right, 90 = up (screen y is inverted)
    return (-this.tweaks.direction * Math.PI) / 180;
  }

  private getCruise(a: Animal): number {
    const meta = SPECIES_MAP[this.species];
    return meta.baseSpeed * (0.55 + 0.45 * a.depth) * this.tweaks.speed;
  }

  private syncMarineSnow(): void {
    if (this.species !== "squid") {
      this.marineSnow = [];
      return;
    }
    const target = clamp(Math.round((this.width * this.height) / 6000), 10, 260);
    while (this.marineSnow.length < target) {
      this.marineSnow.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        speed: 3 + Math.random() * 9,
        phase: Math.random() * Math.PI * 2,
        star: Math.random() < 0.08,
      });
    }
    if (this.marineSnow.length > target) {
      this.marineSnow.length = target;
    }
  }

  private syncPopulation(initial: boolean): void {
    const meta = SPECIES_MAP[this.species];
    const base = this.getBaseSize();
    const norm = base / meta.scale / 160;
    const computed = clamp(
      Math.round(
        ((this.width * this.height) / (meta.area * Math.max(0.25, norm * norm))) *
          this.tweaks.density
      ),
      1,
      200
    );
    const target = this.forcedCount ?? computed;

    while (this.animals.length > target) {
      const idx = Math.floor(Math.random() * this.animals.length);
      this.animals.splice(idx, 1);
    }

    while (this.animals.length < target) {
      const scatterOnScreen = initial || Math.random() < 0.5;
      this.animals.push(this.spawnAnimal(scatterOnScreen));
    }

    this.animals.sort((a, b) => a.roll - b.roll);
  }

  private spawnAnimal(onScreen: boolean): Animal {
    const roll = Math.random();
    const depth =
      this.tweaks.farthest +
      (1 - this.tweaks.farthest) * Math.pow(roll, this.tweaks.farBias);
    const span = this.getBaseSize() * depth * this.tweaks.size;
    const course = this.getCourseRad();
    const bias = Math.random() * 2 - 1;
    const heading = course + bias * this.tweaks.spread;
    const meta = SPECIES_MAP[this.species];
    const speed = meta.baseSpeed * (0.55 + 0.45 * depth) * this.tweaks.speed;

    let x = Math.random() * this.width;
    let y = Math.random() * this.height;
    if (!onScreen) {
      const pos = this.pickUpwindSpawn(course, span);
      x = pos.x;
      y = pos.y;
    }

    return {
      id: this.nextId++,
      x,
      y,
      vx: Math.cos(heading) * speed,
      vy: Math.sin(heading) * speed,
      heading,
      roll,
      depth,
      span,
      bias,
      phase: Math.random() * Math.PI * 2,
      pace: 0.8 + Math.random() * 0.4,
      startleTimer: 0,
      alarm: 0,
      glide: 0,
      glideGoal: 0,
      glideTimer: 0.5 + Math.random() * 2,
      resting: false,
      stateTimer: 0.5 + Math.random() * 1.1,
      owlState: "hover",
      tuck: 0,
      aimOffset: 0,
      leaping: false,
      leapStartX: x,
      leapStartY: y,
      leapTargetX: x,
      leapTargetY: y,
      leapDuration: 0.48,
      leapProgress: 0,
      leapPower: 1,
      turnRate: 0,
      lastFlipperSin: 0,
    };
  }

  private pickUpwindSpawn(
    course: number,
    span: number
  ): { x: number; y: number } {
    const ux = -Math.cos(course);
    const uy = -Math.sin(course);
    const horizWeight = Math.abs(ux) * this.height;
    const vertWeight = Math.abs(uy) * this.width;
    const total = horizWeight + vertWeight;
    if (total <= 0 || Math.random() * total < horizWeight) {
      return {
        x: ux >= 0 ? this.width + span : -span,
        y: Math.random() * this.height,
      };
    }
    return {
      x: Math.random() * this.width,
      y: uy >= 0 ? this.height + span : -span,
    };
  }

  private startFishLeap(a: Animal, dirAngle: number, power = 1): void {
    const leapLength = Math.max(0.15, this.tweaks.leapLength);
    const dist =
      a.span * (2.4 + Math.random() * 1.2) * leapLength * this.tweaks.speed * power;
    let bestAngle = dirAngle;
    if (this.tweaks.separation > 0) {
      const candidates = [1, 0.8, 1.2, 0.65, 1.35];
      let bestClearance = -1;
      let chosenX = a.x + Math.cos(dirAngle) * dist;
      let chosenY = a.y + Math.sin(dirAngle) * dist;
      for (const mult of candidates) {
        const tx = a.x + Math.cos(dirAngle) * dist * mult;
        const ty = a.y + Math.sin(dirAngle) * dist * mult;
        let minClear = 1e9;
        for (const other of this.animals) {
          if (other === a) continue;
          minClear = Math.min(minClear, Math.hypot(other.x - tx, other.y - ty));
        }
        if (minClear > bestClearance) {
          bestClearance = minClear;
          chosenX = tx;
          chosenY = ty;
        }
      }
      a.leapTargetX = chosenX;
      a.leapTargetY = chosenY;
      bestAngle = Math.atan2(chosenY - a.y, chosenX - a.x);
    } else {
      a.leapTargetX = a.x + Math.cos(dirAngle) * dist;
      a.leapTargetY = a.y + Math.sin(dirAngle) * dist;
    }
    a.leaping = true;
    a.leapStartX = a.x;
    a.leapStartY = a.y;
    a.leapDuration = (0.42 + Math.random() * 0.13) * Math.sqrt(leapLength);
    a.leapProgress = 0;
    a.leapPower = power;
    a.heading = bestAngle;
  }

  public step(dt: number): void {
    this.simTime += dt;
    const t = this.simTime;
    const course =
      this.getCourseRad() +
      this.tweaks.sway * (Math.sin(0.13 * t) + 0.5 * Math.sin(0.31 * t + 1.7));

    // Diffuse and decay trails
    const len = this.trailField.length;
    if (len > 0) {
      const decay = Math.exp(-dt * this.tweaks.trailFade);
      const cols = this.cols;
      const rows = this.rows;
      for (let r = 0; r < rows; r++) {
        const rowOff = r * cols;
        const upOff = (r > 0 ? r - 1 : 0) * cols;
        const dnOff = (r < rows - 1 ? r + 1 : rows - 1) * cols;
        for (let c = 0; c < cols; c++) {
          const idx = rowOff + c;
          const self = this.trailField[idx];
          const l = this.trailField[rowOff + (c > 0 ? c - 1 : 0)];
          const rt = this.trailField[rowOff + (c < cols - 1 ? c + 1 : cols - 1)];
          const u = this.trailField[upOff + c];
          const d = this.trailField[dnOff + c];
          this.trailNext[idx] = ((4 * self + l + rt + u + d) / 8) * decay;
        }
      }
      const swap = this.trailField;
      this.trailField = this.trailNext;
      this.trailNext = swap;
    }

    // Update sea turtle food pellets
    if (this.species === "turtles" && this.pellets.length > 0) {
      const drag = Math.exp(-0.8 * dt);
      for (let i = this.pellets.length - 1; i >= 0; i--) {
        const p = this.pellets[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= drag;
        p.vy *= drag;
        p.age += dt;
        if (p.age >= p.maxAge) {
          this.pellets.splice(i, 1);
        }
      }
    }

    // Update marine snow for squid
    if (this.species === "squid") {
      for (const s of this.marineSnow) {
        s.y += s.speed * dt;
        s.x += Math.sin(t * 0.9 + s.phase) * 6 * dt;
        if (s.y > this.height + 6) {
          s.y = -4;
          s.x = Math.random() * this.width;
        }
      }
    }

    const baseSize = this.getBaseSize();

    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i];
      a.depth =
        this.tweaks.farthest +
        (1 - this.tweaks.farthest) * Math.pow(a.roll, this.tweaks.farBias);
      a.span = baseSize * a.depth * this.tweaks.size;

      if (a.startleTimer > 0) a.startleTimer = Math.max(0, a.startleTimer - dt);
      if (a.alarm > 0) a.alarm = Math.max(0, a.alarm - 0.7 * dt);

      const cruise = this.getCruise(a);
      let aim = course + a.bias * this.tweaks.spread;

      // Separation force
      let sepX = 0;
      let sepY = 0;
      if (this.tweaks.separation > 0) {
        const reach = this.species === "eagles" ? 0.45 : 0.72;
        for (let j = 0; j < this.animals.length; j++) {
          if (i === j) continue;
          const b = this.animals[j];
          if (Math.abs(a.depth - b.depth) >= 0.18) continue;
          const minD = (a.span + b.span) * reach;
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.hypot(dx, dy);
          if (dist > 0.1 && dist < minD) {
            const push = (1 - dist / minD) * this.tweaks.separation;
            sepX += (dx / dist) * push;
            sepY += (dy / dist) * push;
          }
        }
      }

      if (this.species === "moths") {
        a.glideTimer -= dt;
        if (a.glideTimer <= 0) {
          if (a.glideGoal === 0 && Math.random() < 0.35 * this.tweaks.glide * dt) {
            a.glideGoal = 1;
            a.glideTimer = 0.5 + Math.random() * 0.9;
          } else {
            a.glideGoal = 0;
            a.glideTimer = 0.6 + Math.random() * 1.4;
          }
        }
        if (a.startleTimer > 0) a.glideGoal = 0;
        a.glide += (a.glideGoal - a.glide) * Math.min(1, 6 * dt);

        const speedNow = Math.hypot(a.vx, a.vy);
        const speedFrac = clamp(speedNow / Math.max(1, cruise), 0, 1.5);
        a.phase +=
          dt *
          2.6 *
          Math.PI *
          2 *
          this.tweaks.flapRate *
          (0.8 + 0.6 * speedFrac) *
          (1 - 0.9 * a.glide);

        const downstroke = Math.max(0, -Math.sin(a.phase));
        const targetSpeed = cruise * (1 + 0.4 * downstroke);
        const flutterImpulse =
          this.tweaks.flutter > 0
            ? Math.sqrt(dt) * 520 * 1.3 * this.tweaks.flutter * (1 - 0.7 * a.glide)
            : 0;
        const ax =
          (Math.cos(aim) * targetSpeed - a.vx) * this.tweaks.grip + sepX;
        const ay =
          (Math.sin(aim) * targetSpeed - a.vy) * this.tweaks.grip + sepY;
        a.vx +=
          ax * dt +
          (flutterImpulse ? (Math.random() - 0.5) * flutterImpulse : 0) -
          (flutterImpulse ? 3 * a.vx * dt * 0.15 : 0);
        a.vy +=
          ay * dt +
          (flutterImpulse ? (Math.random() - 0.5) * flutterImpulse : 0) -
          (flutterImpulse ? 3 * a.vy * dt * 0.15 : 0);

        // Wingtip trail shedding
        const open =
          0.1 +
          0.9 *
            (Math.pow(0.5 + 0.5 * Math.cos(a.phase), 0.8) * (1 - a.glide) +
              0.96 * a.glide);
        const tipDist = 0.42 * a.span * open;
        const nx = -Math.sin(a.heading);
        const ny = Math.cos(a.heading);
        const shedAmt = (0.04 + 0.08 * downstroke) * a.depth;
        this.shedTrail(a.x + nx * tipDist, a.y + ny * tipDist, shedAmt);
        this.shedTrail(a.x - nx * tipDist, a.y - ny * tipDist, shedAmt);
      } else if (this.species === "rabbits") {
        a.stateTimer -= dt;
        if (a.stateTimer <= 0 && a.startleTimer <= 0) {
          a.resting = this.tweaks.pause > 0 ? !a.resting : false;
          a.stateTimer = a.resting
            ? (0.3 + Math.random() * 1.1) * this.tweaks.pause
            : (0.5 + Math.random() * 1.1) * Math.max(0.1, this.tweaks.burst);
        }
        const targetSpeed = a.resting && a.startleTimer <= 0 ? 0 : cruise;
        const ax =
          (Math.cos(aim) * targetSpeed - a.vx) * (2 * this.tweaks.grip) + sepX;
        const ay =
          (Math.sin(aim) * targetSpeed - a.vy) * (2 * this.tweaks.grip) + sepY;
        a.vx += ax * dt;
        a.vy += ay * dt;
        const spd = Math.hypot(a.vx, a.vy);
        if (spd > 12) {
          const hop = Math.min(1, spd / 30);
          const prevCycle = Math.floor(a.phase / (Math.PI * 2));
          a.phase +=
            ((dt * Math.max(spd, 30 * hop) * this.tweaks.hopSpeed) /
              Math.max(4, 0.32 * a.span)) *
            Math.PI *
            2;
          const nextCycle = Math.floor(a.phase / (Math.PI * 2));
          if (nextCycle > prevCycle) {
            this.stampTrail(a.x, a.y + 0.14 * a.span, 0, 0.5 * a.depth);
          }
        }
      } else if (this.species === "turtles") {
        let hungry = false;
        let nearest: FoodPellet | null = null;
        let bestDist = Math.max(0, this.tweaks.foodRange);
        for (const p of this.pellets) {
          const d = Math.hypot(p.x - a.x, p.y - a.y);
          if (d < bestDist) {
            bestDist = d;
            nearest = p;
          }
        }
        if (nearest) {
          hungry = true;
          aim = Math.atan2(nearest.y - a.y, nearest.x - a.x);
          if (bestDist <= 0.32 * a.span + 6) {
            this.stampTrail(nearest.x, nearest.y, 1, 0.7);
            const idx = this.pellets.indexOf(nearest);
            if (idx >= 0) this.pellets.splice(idx, 1);
          }
        } else {
          aim += this.tweaks.meander * 0.6 * Math.sin(0.35 * t + 1.7 * a.id);
        }
        const sepAng = sepX || sepY ? Math.atan2(sepY, sepX) : aim;
        const blendedAim =
          sepX || sepY ? turnToward(aim, sepAng, 0.45) : aim;
        const maxTurn = (hungry ? 2.6 : 0.9 * this.tweaks.grip) * dt;
        a.heading = turnToward(a.heading, blendedAim, maxTurn);
        const speedMult = hungry
          ? 1.8
          : 0.85 + 0.25 * Math.sin(0.5 * t + a.id);
        const spd = cruise * speedMult;
        a.vx = Math.cos(a.heading) * spd;
        a.vy = Math.sin(a.heading) * spd;
        a.phase += dt * (1.4 + spd / 40) * this.tweaks.flipperBeat;
        this.shedTrail(
          a.x - Math.cos(a.heading) * 0.28 * a.span,
          a.y - Math.sin(a.heading) * 0.28 * a.span,
          0.08 * a.depth
        );
      } else if (this.species === "squid") {
        const prevHeading = a.heading;
        a.phase =
          (a.phase + dt * 0.6 * this.tweaks.pulseRate * (0.9 + 0.2 * a.roll)) % 1;
        const squeeze =
          a.phase < 0.22
            ? Math.sin(((a.phase / 0.22) * Math.PI) / 2)
            : 1 - (a.phase - 0.22) / 0.78;
        if (a.phase < 0.22) {
          const thrust = 6.2 * cruise * this.tweaks.pulsePower;
          a.vx += Math.cos(a.heading) * thrust * dt;
          a.vy += Math.sin(a.heading) * thrust * dt;
        }
        a.vx += (-1.4 * a.vx + sepX * 0.5) * dt;
        a.vy += (-1.4 * a.vy + sepY * 0.5) * dt;
        a.heading = turnToward(a.heading, aim, 0.6 * this.tweaks.grip * dt);
        const dH = wrapAngle(a.heading - prevHeading) / Math.max(0.001, dt);
        a.turnRate += (dH - a.turnRate) * Math.min(1, 8 * dt);
        if (squeeze > 0.3) {
          this.shedTrail(
            a.x - Math.cos(a.heading) * 0.55 * a.span,
            a.y - Math.sin(a.heading) * 0.55 * a.span,
            0.03 * a.depth
          );
        }
      } else if (this.species === "owls") {
        a.stateTimer -= dt;
        if (a.stateTimer <= 0) {
          if (a.owlState === "hover") {
            a.owlState = "swoop";
            a.stateTimer = 0.15 + Math.random() * 0.3;
          } else if (a.owlState === "swoop") {
            if (Math.random() < this.tweaks.cruising) {
              a.owlState = "cruise";
              a.stateTimer = 1.2 + Math.random() * 3.3;
              a.aimOffset = (Math.random() - 0.5) * 0.4;
            } else {
              a.owlState = "hover";
              a.stateTimer =
                clamp(-Math.log(Math.random() || 0.5) * 0.7, 0.15, 3) *
                this.tweaks.hoverTime;
            }
          } else {
            if (Math.random() < 0.35) {
              a.owlState = "swoop";
              a.stateTimer = 0.15 + Math.random() * 0.3;
            } else {
              a.owlState = "hover";
              a.stateTimer =
                clamp(-Math.log(Math.random() || 0.5) * 0.7, 0.15, 3) *
                this.tweaks.hoverTime;
            }
          }
        }
        const tuckTarget = a.owlState === "swoop" ? 1 : 0;
        a.tuck += (tuckTarget - a.tuck) * Math.min(1, 10 * dt);
        const wingFreq = a.owlState === "hover" ? 3.4 : 2.2;
        a.phase +=
          dt *
          wingFreq *
          Math.PI *
          2 *
          this.tweaks.wingbeat *
          (1 - 0.85 * a.tuck);

        let targetSpeed = cruise;
        let gain = this.tweaks.grip;
        let wobbleX = 0;
        let wobbleY = 0;
        if (a.owlState === "hover") {
          targetSpeed = cruise * 0.25;
          wobbleX = Math.sin(t * 2.1 + a.id) * 40;
          wobbleY = Math.cos(t * 4.2 + a.id) * 40;
        } else if (a.owlState === "swoop") {
          targetSpeed = cruise * 4 * this.tweaks.swoopSpeed;
          gain = 14;
          this.shedTrail(a.x, a.y, 0.12 * a.depth);
        } else {
          aim += a.aimOffset;
        }
        a.vx +=
          ((Math.cos(aim) * targetSpeed - a.vx) * gain + sepX + wobbleX) * dt;
        a.vy +=
          ((Math.sin(aim) * targetSpeed - a.vy) * gain + sepY + wobbleY) * dt;
      } else if (this.species === "flyingfish") {
        if (a.leaping) {
          a.leapProgress += dt / a.leapDuration;
          if (a.leapProgress >= 1) {
            a.x = a.leapTargetX;
            a.y = a.leapTargetY;
            a.leaping = false;
            a.stateTimer =
              (0.5 + Math.random() * 1.7) /
              Math.max(0.1, this.tweaks.howOften * this.tweaks.speed);
            a.aimOffset = (Math.random() - 0.5) * 0.7 * this.tweaks.spread;
            this.stampTrail(a.x, a.y, 2, 0.7 * a.depth);
          } else {
            a.x = a.leapStartX + (a.leapTargetX - a.leapStartX) * a.leapProgress;
            a.y = a.leapStartY + (a.leapTargetY - a.leapStartY) * a.leapProgress;
          }
        } else {
          a.heading = turnToward(a.heading, aim + a.aimOffset, 3 * dt);
          a.vx = 0;
          a.vy = 0;
          a.stateTimer -= dt;
          if (a.stateTimer <= 0) {
            const leapAim = clamp(
              wrapAngle(aim + a.aimOffset - course),
              -0.35,
              0.35
            );
            this.startFishLeap(a, course + leapAim, 1);
          }
        }
      } else if (this.species === "eagles") {
        a.glideTimer -= dt;
        if (a.glideTimer <= 0) {
          if (a.glideGoal === 0 && Math.random() < 0.25 * this.tweaks.glide * dt) {
            a.glideGoal = 1;
            a.glideTimer = 1 + Math.random() * 1.5;
          } else {
            a.glideGoal = 0;
            a.glideTimer = 1.2 + Math.random() * 1.8;
          }
        }
        a.glide += (a.glideGoal - a.glide) * Math.min(1, 3 * dt);
        a.phase +=
          dt *
          1.25 *
          Math.PI *
          2 *
          this.tweaks.wingbeat *
          a.pace *
          (1 - 0.92 * a.glide);
        const ax = (Math.cos(aim) * cruise - a.vx) * this.tweaks.grip + sepX;
        const ay = (Math.sin(aim) * cruise - a.vy) * this.tweaks.grip + sepY;
        a.vx += ax * dt;
        a.vy += ay * dt;
      }

      if (this.species !== "flyingfish") {
        const cap =
          cruise * (this.species === "owls" ? 5.2 : 1.6) +
          (a.startleTimer > 0 ? 300 : 0);
        const spd = Math.hypot(a.vx, a.vy);
        if (spd > cap && cap > 0) {
          a.vx = (a.vx / spd) * cap;
          a.vy = (a.vy / spd) * cap;
        }
        a.x += a.vx * dt;
        a.y += a.vy * dt;

        if (spd > 6 && this.species !== "turtles" && this.species !== "squid") {
          const velAngle = Math.atan2(a.vy, a.vx);
          const turnRate =
            this.species === "rabbits"
              ? a.startleTimer > 0
                ? 10
                : 3
              : this.species === "eagles"
                ? 2
                : 6;
          a.heading = turnToward(a.heading, velAngle, turnRate * dt);
        }
      }

      // Wrap off-screen animals back upwind
      const dxCourse = Math.cos(course);
      const dyCourse = Math.sin(course);
      const margin = a.span * 3;
      const offAll =
        a.x < -margin ||
        a.x > this.width + margin ||
        a.y < -margin ||
        a.y > this.height + margin;
      const pastDownwind =
        (dxCourse > 0.2 && a.x > this.width + a.span) ||
        (dxCourse < -0.2 && a.x < -a.span) ||
        (dyCourse > 0.2 && a.y > this.height + a.span) ||
        (dyCourse < -0.2 && a.y < -a.span);

      if (offAll || pastDownwind) {
        const respawn = this.pickUpwindSpawn(course, a.span);
        a.x = respawn.x;
        a.y = respawn.y;
        a.leapStartX = respawn.x;
        a.leapStartY = respawn.y;
        a.leapTargetX = respawn.x;
        a.leapTargetY = respawn.y;
        a.leaping = false;
      }
    }
  }

  private shedTrail(px: number, py: number, amount: number): void {
    if (this.tweaks.trail <= 0) return;
    const c = Math.floor(px / this.cw);
    const r = Math.floor(py / this.ch);
    if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) return;
    const idx = r * this.cols + c;
    this.trailField[idx] = Math.min(
      1.6,
      this.trailField[idx] + amount * this.tweaks.trail
    );
  }

  private stampTrail(px: number, py: number, radius: number, amount: number): void {
    const cc = Math.floor(px / this.cw);
    const cr = Math.floor(py / this.ch);
    for (let dr = -radius; dr <= radius; dr++) {
      const r = cr + dr;
      if (r < 0 || r >= this.rows) continue;
      for (let dc = -radius; dc <= radius; dc++) {
        const c = cc + dc;
        if (c < 0 || c >= this.cols) continue;
        const d = Math.hypot(dc, dr * 1.4);
        if (radius > 0 && d > radius) continue;
        const falloff = radius === 0 ? 1 : 1 - d / (radius + 0.5);
        const idx = r * this.cols + c;
        this.trailField[idx] = Math.min(
          1.6,
          this.trailField[idx] + amount * falloff * Math.max(0.25, this.tweaks.trail)
        );
      }
    }
  }

  private ensureBackground(dpr: number): void {
    if (!this.bgCanvas || !this.bgDirty) return;
    this.bgDirty = false;
    const targetW = Math.max(1, Math.round(this.width * dpr));
    const targetH = Math.max(1, Math.round(this.height * dpr));
    if (this.bgCanvas.width !== targetW || this.bgCanvas.height !== targetH) {
      this.bgCanvas.width = targetW;
      this.bgCanvas.height = targetH;
    }
    const bctx = this.bgCanvas.getContext("2d");
    if (!bctx) return;
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    bctx.fillStyle = "rgb(6,7,12)";
    bctx.fillRect(0, 0, this.width, this.height);

    const gridAlpha = clamp(0.055 * this.tweaks.grid, 0, 0.35);
    if (gridAlpha > 0.002) {
      bctx.strokeStyle = `rgba(255,255,255,${gridAlpha})`;
      bctx.lineWidth = 1;
      bctx.beginPath();
      for (let x = 0; x <= this.width; x += this.cw) {
        const px = Math.floor(x) + 0.5;
        bctx.moveTo(px, 0);
        bctx.lineTo(px, this.height);
      }
      for (let y = 0; y <= this.height; y += this.ch) {
        const py = Math.floor(y) + 0.5;
        bctx.moveTo(0, py);
        bctx.lineTo(this.width, py);
      }
      bctx.stroke();
    }
  }

  private putCell(
    col: number,
    row: number,
    cell: GridCell,
    allowOverSolid = false
  ): void {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;
    const idx = row * this.cols + col;
    const existing = this.cellGrid[idx];
    if (existing && existing.solid && !cell.solid && !allowOverSolid) {
      return;
    }
    this.cellGrid[idx] = cell;
  }

  private drawLinePrimitive(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    color: RGB,
    endGlyph?: string
  ): void {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / (this.cw * 0.5)));
    const ang = Math.atan2(y1 - y0, x1 - x0);
    const normAng = ((ang % Math.PI) + Math.PI) % Math.PI;
    let lineGlyph = "-";
    if (normAng > Math.PI * 0.125 && normAng <= Math.PI * 0.375) {
      lineGlyph = "\\";
    } else if (normAng > Math.PI * 0.375 && normAng <= Math.PI * 0.625) {
      lineGlyph = "|";
    } else if (normAng > Math.PI * 0.625 && normAng <= Math.PI * 0.875) {
      lineGlyph = "/";
    }
    const cStr = rgbStr(color);
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      const col = Math.floor((x0 + (x1 - x0) * f) / this.cw);
      const row = Math.floor((y0 + (y1 - y0) * f) / this.ch);
      const glyph = s === steps && endGlyph ? endGlyph : lineGlyph;
      this.putCell(col, row, {
        solid: false,
        fill: "",
        glyph,
        glyphColor: cStr,
      });
    }
  }

  private drawSpotPrimitive(
    x: number,
    y: number,
    fill: RGB,
    glyphColor: RGB,
    glyph = "●"
  ): void {
    const col = Math.floor(x / this.cw);
    const row = Math.floor(y / this.ch);
    this.putCell(
      col,
      row,
      {
        solid: true,
        fill: rgbStr(fill),
        glyph,
        glyphColor: rgbStr(glyphColor),
      },
      true
    );
  }

  private sampleAnimalShape(
    a: Animal,
    u: number,
    v: number
  ): ShapeSample | false {
    if (this.species === "moths") {
      const open =
        0.1 +
        0.9 *
          (Math.pow(0.5 + 0.5 * Math.cos(a.phase), 0.8) * (1 - a.glide) +
            0.96 * a.glide);
      const light = 0.6 + 0.4 * open;
      // Head & thorax
      if (inEllipse(u, v, 0.15, 0, 0.04, 0.04) !== null) {
        return { color: [112 * light, 70 * light, 50 * light], kind: "Fur", glyphs: "%#8" };
      }
      if (u >= -0.04 && u <= 0.11 && Math.abs(v) <= 0.05) {
        return { color: [112 * light, 70 * light, 50 * light], kind: "Fur", glyphs: "%#8" };
      }
      if (u >= -0.34 && u < -0.04) {
        const s = (u + 0.34) / 0.3;
        const hw = 0.016 + 0.03 * s;
        if (Math.abs(v) <= hw) {
          const band = Math.floor((u + 0.34) * 22) % 2 === 0;
          const base: RGB = band ? [70, 42, 32] : [150, 98, 72];
          return {
            color: [base[0] * light, base[1] * light, base[2] * light],
            kind: "Fur",
          };
        }
      }

      const foreR = polarLobe(u, v, 0.05, -0.78, 0.46, 0.64, 0.7, 0.3, open);
      if (foreR !== null) {
        if (foreR > 0.86) {
          const dot = Math.sin(u * 40 + Math.abs(v) * 40) > 0.65;
          return dot
            ? { color: [252 * light, 230 * light, 204 * light], kind: "Light" }
            : { color: [84 * light, 46 * light, 32 * light], kind: "Dark" };
        }
        if (foreR < 0.1) {
          return { color: [120 * light, 72 * light, 50 * light], kind: "Dark" };
        }
        if (Math.abs(foreR - 0.5 + 0.04 * Math.sin(v * 24)) < 0.055) {
          return { color: [150 * light, 88 * light, 60 * light], kind: "Dark" };
        }
        return {
          color: [
            (200 + 48 * foreR) * light,
            (132 + 46 * foreR) * light,
            (96 + 40 * foreR) * light,
          ],
          kind: "Shine",
        };
      }

      const hindR = polarLobe(
        u,
        v,
        -0.05,
        -1.55,
        -0.3,
        0.38,
        0.5,
        0.55,
        open,
        0.07
      );
      if (hindR !== null) {
        if (inEllipse(u, Math.abs(v), -0.18, 0.14 * open, 0.045, 0.045) !== null) {
          return { color: [68 * light, 38 * light, 26 * light], kind: "Dark", glyphs: "@" };
        }
        if (hindR > 0.86) {
          return { color: [84 * light, 46 * light, 32 * light], kind: "Dark" };
        }
        return {
          color: [
            (200 + 48 * hindR) * light,
            (132 + 46 * hindR) * light,
            (96 + 40 * hindR) * light,
          ],
          kind: "Shine",
        };
      }
      return false;
    }

    if (this.species === "rabbits") {
      // Side-view coordinates: +u forward, +v down
      const stretch = Math.sin(a.phase - 0.4) * 0.04;
      const air = Math.max(0, Math.sin(a.phase * 0.5));
      const earTilt = 0.35 + 0.35 * air + 0.25 * a.alarm;

      const checkEar = (eu: number, ev: number, shade: number): ShapeSample | false => {
        const dx = u - eu;
        const dy = v - ev;
        const along = -dx * Math.sin(earTilt) - dy * Math.cos(earTilt);
        const across = dx * Math.cos(earTilt) - dy * Math.sin(earTilt);
        if (along >= 0 && along <= 0.24) {
          const w = 0.034 * (1 - 0.45 * (along / 0.24));
          if (Math.abs(across) <= w) {
            if (shade > 0.9 && Math.abs(across) < w * 0.42 && along > 0.04 && along < 0.2) {
              return { color: [244, 150, 156], kind: "Light" };
            }
            return {
              color: [248 * shade, 199 * shade, 181 * shade],
              kind: "Fur",
              glyphs: "%8",
            };
          }
        }
        return false;
      };

      const nearEar = checkEar(0.13, -0.12, 1);
      if (nearEar) return nearEar;
      const farEar = checkEar(0.105, -0.11, 0.82);
      if (farEar) return farEar;

      if (inEllipse(u, v, -0.28 - stretch * 0.5, -0.01, 0.048, 0.048) !== null) {
        return { color: [255, 250, 246], kind: "Light", glyphs: "*@" };
      }

      const head = inEllipse(u, v, 0.17 + stretch * 0.4, -0.07, 0.09, 0.072);
      if (head !== null) {
        if (u > 0.24 + stretch * 0.4 && Math.abs(v + 0.065) < 0.02) {
          return { color: [244, 150, 156], kind: "Light" };
        }
        return { color: [248, 199, 181], kind: "Fur", glyphs: "%8" };
      }

      const body = inEllipse(u, v, -0.05, 0.02, 0.2 + stretch, 0.125);
      const haunch = inEllipse(u, v, -0.15 - stretch * 0.6, 0.05, 0.12, 0.12);
      const foot = inEllipse(u, v, -0.18 - stretch * 1.4, 0.14, 0.085, 0.032);
      if (body !== null || haunch !== null || foot !== null) {
        if (v > 0.08) {
          return { color: [206, 150, 132], kind: "Fur", glyphs: "%8" };
        }
        return { color: [248, 199, 181], kind: "Fur", glyphs: "%8" };
      }
      return false;
    }

    if (this.species === "turtles") {
      // Head
      if (inEllipse(u, v, 0.33, 0, 0.085, 0.07) !== null) {
        return { color: [142, 200, 164], kind: "Plain" };
      }
      if (u >= 0.2 && u <= 0.28 && Math.abs(v) <= 0.045) {
        return { color: [142, 200, 164], kind: "Plain" };
      }
      if (u <= -0.27 && u >= -0.35 && Math.abs(v) <= 0.025 * (1 - (-0.27 - u) / 0.09)) {
        return { color: [120, 178, 144], kind: "Plain" };
      }

      // Front & rear flippers
      const fAng = 1.25 - 0.6 * Math.sin(a.phase);
      const checkFlipper = (
        fu: number,
        fv: number,
        len: number,
        ang: number,
        wid: number
      ): boolean => {
        const av = Math.abs(v);
        const dx = u - fu;
        const dy = av - fv;
        const along = dx * Math.cos(ang) + dy * Math.sin(ang);
        const across = -dx * Math.sin(ang) + dy * Math.cos(ang);
        if (along < 0 || along > len) return false;
        const w = wid * Math.sin((along / len) * Math.PI) + 0.012;
        return Math.abs(across) <= w;
      };
      if (
        checkFlipper(0.12, 0.17, 0.24, fAng, 0.055) ||
        checkFlipper(-0.2, 0.13, 0.11, 2.5 + 0.28 * Math.sin(a.phase + 1.4), 0.04)
      ) {
        return { color: [126, 188, 152], kind: "Soft" };
      }

      // Shell
      const sr = inEllipse(u, v, -0.02, 0, 0.28, 0.22);
      if (sr !== null) {
        if (sr > 0.83) {
          return { color: [74, 132, 100], kind: "Dark", glyphs: "=" };
        }
        const av = Math.abs(v) / 0.22;
        const seamV = Math.abs(av - 0.34) < 0.06;
        const seamCross =
          Math.abs(((u + 0.3) * (av < 0.34 ? 1.7 : 1.4)) % 0.18 - 0.09) < 0.02;
        if (seamV || seamCross) {
          return { color: [40, 84, 62], kind: "Dark", glyphs: "=" };
        }
        const boost = 0.86 + 0.32 * (1 - sr);
        return {
          color: [109 * boost, 176 * boost, 138 * boost],
          kind: "Shine",
        };
      }
      return false;
    }

    if (this.species === "squid") {
      const squeeze =
        a.phase < 0.22
          ? Math.sin(((a.phase / 0.22) * Math.PI) / 2)
          : 1 - (a.phase - 0.22) / 0.78;
      const glow =
        a.phase < 0.16
          ? Math.sin(((a.phase / 0.16) * Math.PI) / 2)
          : Math.exp(-4.5 * (a.phase - 0.16));

      // Fins over rear 38% of mantle
      if (u >= 0.31 && u <= 0.52) {
        const s = (u - 0.31) / 0.21;
        const fw = 0.06 + 0.11 * Math.sin(s * Math.PI);
        if (Math.abs(v) <= fw && Math.abs(v) > 0.04) {
          return { color: [232, 118, 172], kind: "Soft" };
        }
      }

      // Mantle
      if (u >= -0.02 && u <= 0.52) {
        const s = (u + 0.02) / 0.54;
        const hw = 0.1 * (1 - 0.16 * squeeze) * Math.sqrt(Math.max(0, 1 - Math.pow(s, 2.4)));
        if (Math.abs(v) <= hw) {
          if (Math.abs(v) > hw * 0.82) {
            return { color: [255, 200, 226], kind: "Bright", glyphs: ":;" };
          }
          if (Math.abs(v) < 0.015) {
            return { color: [255, 200, 226], kind: "Bright", glyphs: "|" };
          }
          const speckSeed = Math.floor(this.simTime * 2);
          if (hash2d(a.id + speckSeed, Math.round(u * 30), Math.round(v * 30)) < 0.11) {
            return { color: [150, 40, 96], kind: "Dark", glyphs: "%#" };
          }
          const centerBoost = 1 + 0.22 * (1 - Math.abs(v) / Math.max(0.01, hw));
          return {
            color: [232 * centerBoost, 106 * centerBoost, 160 * centerBoost],
            kind: "Shine",
          };
        }
        // Pulse glow halo
        const glowAmt = glow * this.tweaks.pulseGlow;
        if (glowAmt > 0.1 && Math.abs(v) <= hw + 0.05 * glowAmt) {
          return {
            color: [
              clamp(255 * glowAmt, 0, 255),
              clamp(160 * glowAmt, 0, 255),
              clamp(210 * glowAmt, 0, 255),
            ],
            kind: "Line",
            glyphs: ".",
          };
        }
      }

      if (inEllipse(u, v, -0.06, 0, 0.06, 0.065) !== null) {
        return { color: [232, 106, 160], kind: "Plain" };
      }
      return false;
    }

    if (this.species === "owls") {
      const opening = Math.max(
        0.3,
        (0.55 + 0.45 * Math.pow(0.5 + 0.5 * Math.cos(a.phase), 0.8)) *
          (1 - 0.5 * a.tuck)
      );
      const faceR = inEllipse(u, v, 0.13, 0, 0.1, 0.1);
      if (faceR !== null) {
        if (faceR > 0.82) return { color: [128, 100, 70], kind: "Dark" };
        if (Math.abs(v) < 0.025 && u > 0.1 && u < 0.15) {
          return { color: [190, 146, 86], kind: "Dark", glyphs: "v" };
        }
        return { color: [244, 232, 206], kind: "Light" };
      }

      if (inEllipse(u, v, -0.06, 0, 0.16, 0.085) !== null) {
        if (Math.floor((u + 0.2) * 18) % 3 === 0) {
          return { color: [150, 118, 82], kind: "Dark", glyphs: "v" };
        }
        return { color: [217, 195, 160], kind: "Fur", glyphs: "%8" };
      }

      if (u >= -0.34 && u <= -0.18 && Math.abs(v) <= 0.055) {
        const bar = Math.floor((u + 0.34) * 28) % 2 === 0;
        return bar
          ? { color: [150, 118, 82], kind: "Dark" }
          : { color: [217, 195, 160], kind: "Plain" };
      }

      const av = Math.abs(v);
      const wingMax = 0.06 + 0.5 * opening;
      if (av >= 0.06 && av <= wingMax) {
        const s = (av - 0.06) / (wingMax - 0.06);
        const lead = 0.12 - 0.04 * s - 0.06 * s * s;
        const trail =
          -0.18 + 0.08 * s - 0.015 * Math.cos(s * Math.PI * 10);
        if (u <= lead && u >= trail) {
          if (s > 0.8 && Math.sin(u * 60) < -0.35) {
            return false; // slotted finger feathers
          }
          if (s < 0.55 && u > lead - 0.08) {
            return { color: [238, 220, 184], kind: "Light" };
          }
          if (Math.floor((s * 8 + (lead - u) * 14) % 2) === 0 && u < lead - 0.12) {
            return { color: [150, 118, 82], kind: "Dark" };
          }
          const lightBoost = 0.9 + 0.15 * clamp((u - trail) / Math.max(0.01, lead - trail), 0, 1);
          return {
            color: [217 * lightBoost, 195 * lightBoost, 160 * lightBoost],
            kind: "Plain",
          };
        }
      }
      return false;
    }

    if (this.species === "flyingfish") {
      const wingOpen =
        a.leaping && a.leapProgress >= 0.16 && a.leapProgress <= 0.72
          ? 1
          : 0.42;
      // Pectoral wings
      const pect = polarLobe(
        u,
        v,
        0.12,
        -1.2,
        -0.12,
        0.46,
        0.36,
        0.35,
        wingOpen,
        0.06
      );
      if (pect !== null) {
        const ray = Math.abs((Math.atan2(u - 0.12, Math.abs(v) / wingOpen) + 1.2) * 8 % 1 - 0.5) < 0.09;
        return ray
          ? { color: [92, 190, 186], kind: "Line" }
          : { color: [160, 238, 232], kind: "Soft", glyphs: ".:" };
      }

      // Pelvic fins
      const pelv = polarLobe(u, v, -0.1, -1.2, -0.15, 0.2, 0.4, 0.4, 0.8);
      if (pelv !== null) {
        return { color: [160, 238, 232], kind: "Soft", glyphs: ".:" };
      }

      // Forked tail
      if (u <= -0.28 && u >= -0.46) {
        const ts = (-0.28 - u) / 0.18;
        if (Math.abs(v) >= 0.02 * ts && Math.abs(v) <= 0.03 + 0.13 * ts) {
          return { color: [92, 190, 186], kind: "Soft", glyphs: ".:" };
        }
      }

      // Body
      if (u >= -0.3 && u <= 0.32) {
        const s = (u + 0.3) / 0.62;
        const hw = 0.082 * Math.sin(s * Math.PI);
        if (Math.abs(v) <= hw) {
          if (v < -hw * 0.35) {
            return { color: [62, 150, 150], kind: "Dark", glyphs: "=:" };
          }
          if (v > hw * 0.4) {
            return { color: [224, 250, 246], kind: "Light", glyphs: "o." };
          }
          return { color: [133, 227, 221], kind: "Shine" };
        }
      }
      return false;
    }

    // Eagles (seen from below)
    const cycleFrac = ((a.phase % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / (Math.PI * 2);
    const flap = Math.pow(0.5 + 0.5 * Math.cos(a.phase), 0.8);
    let arm = Math.max(0.12, 0.25 + 0.75 * (flap * (1 - a.glide) + a.glide));
    let hand = arm;
    let handSweep = 0;
    if (this.tweaks.foldingFlap) {
      const downAng =
        cycleFrac < 0.6
          ? 0.85 - (1.45 * cycleFrac) / 0.6
          : -0.6 + (1.45 * (cycleFrac - 0.6)) / 0.4;
      const upFold = cycleFrac >= 0.6 ? Math.sin(((cycleFrac - 0.6) / 0.4) * Math.PI) : 0;
      const flatPose = 1 - a.glide;
      arm = clamp(Math.cos(downAng * 0.65) * flatPose + a.glide, 0.28, 1);
      hand = clamp((arm * (1 - 0.45 * upFold)) * flatPose + a.glide, 0.2, 1);
      handSweep = upFold * 0.35 * flatPose;
    }
    const light = 0.82 + 0.18 * arm;

    // Gold hooked beak
    if (u > 0.28 && u <= 0.33 && Math.abs(v) < 0.02 * (1 - (u - 0.28) / 0.05)) {
      return { color: [240 * light, 190 * light, 70 * light], kind: "Light", glyphs: "@v" };
    }
    // White head
    if (inEllipse(u, v, 0.215, 0, 0.075, 0.048) !== null) {
      return { color: [252 * light, 252 * light, 255 * light], kind: "Light", glyphs: "o." };
    }
    // Body
    if (inEllipse(u, v, 0.02, 0, 0.17, 0.062) !== null) {
      const chest = Math.floor((u + 0.15) * 18) % 3 === 0;
      return chest
        ? { color: [200 * light, 206 * light, 224 * light], kind: "Plain", glyphs: "v" }
        : { color: [236 * light, 238 * light, 246 * light], kind: "Plain" };
    }
    // White fan tail
    if (u <= -0.14 && u >= -0.38) {
      const ts = (-0.14 - u) / 0.24;
      const tw = 0.04 + 0.08 * ts;
      if (Math.abs(v) <= tw) {
        if (ts > 0.88 && Math.sin(v * 80) < -0.4) return false;
        return { color: [242 * light, 244 * light, 250 * light], kind: "Light" };
      }
    }
    // Wings
    const av = Math.abs(v);
    const wristV = 0.05 + 0.2 * arm;
    const wingMax = wristV + 0.29 * hand;
    if (av >= 0.05 && av <= wingMax) {
      const s = (av - 0.05) / Math.max(0.01, wingMax - 0.05);
      const foldedU = av > wristV ? u + (av - wristV) * handSweep : u;
      const lead = 0.13 + 0.02 * s - 0.07 * s * s;
      const trail =
        -0.115 + 0.025 * s - (s < 0.74 ? 0.012 * Math.cos(s * Math.PI * 8) : 0);
      if (foldedU <= lead && foldedU >= trail) {
        if (s > 0.7 && Math.sin(foldedU * 56) < -0.35) {
          return false; // finger primaries
        }
        if (s > 0.72) {
          return { color: [112 * light, 120 * light, 144 * light], kind: "Dark" };
        }
        if (foldedU < lead - 0.12) {
          return { color: [150 * light, 158 * light, 180 * light], kind: "Dark", glyphs: "=#" };
        }
        return { color: [236 * light, 238 * light, 246 * light], kind: "Plain" };
      }
    }

    return false;
  }

  public render(ctx: CanvasRenderingContext2D): void {
    const dpr = Math.min(2, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    this.ensureBackground(dpr);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.bgCanvas) {
      ctx.drawImage(this.bgCanvas, 0, 0, this.width, this.height);
    } else {
      ctx.fillStyle = "rgb(6,7,12)";
      ctx.fillRect(0, 0, this.width, this.height);
    }

    this.cellGrid.fill(null);

    const t = this.simTime;
    const flickerBucket = Math.floor(t * 6);
    const sparkleBucket = Math.floor(t * 2.4);
    const cw = this.cw;
    const ch = this.ch;

    // Rasterize marine snow (squid)
    if (this.species === "squid") {
      for (const s of this.marineSnow) {
        const col = Math.floor(s.x / cw);
        const row = Math.floor(s.y / ch);
        const c = rotateHue([255, 176, 214], this.tweaks.hue);
        const tw = 0.4 + 0.6 * (0.5 + 0.5 * Math.sin(t * 1.4 + s.phase));
        this.putCell(col, row, {
          solid: false,
          fill: "",
          glyph: s.star ? "*" : ".",
          glyphColor: rgbStr(mixRgb(BG_RGB, c, tw * (1 - 0.3 * this.tweaks.fog))),
        });
      }
    }

    // Rasterize sea turtle pellets
    if (this.species === "turtles") {
      for (const p of this.pellets) {
        const col = Math.floor(p.x / cw);
        const row = Math.floor(p.y / ch);
        const lifeFrac = p.age / p.maxAge;
        const fade = lifeFrac > 0.7 ? (1 - lifeFrac) / 0.3 : 1;
        const c = rotateHue(
          mixRgb(BG_RGB, [190, 226, 150], clamp(fade, 0, 1)),
          this.tweaks.hue
        );
        this.putCell(col, row, {
          solid: false,
          fill: "",
          glyph: lifeFrac > 0.55 ? "." : "o",
          glyphColor: rgbStr(c),
        });
      }
    }

    // Rasterize animals sorted back-to-front
    const extent =
      this.species === "moths"
        ? 0.78
        : this.species === "eagles"
          ? 0.68
          : this.species === "owls"
            ? 0.66
            : this.species === "squid"
              ? 0.9
              : 0.58;

    for (const a of this.animals) {
      const drawX = a.x;
      let drawY = a.y;
      let drawSpan = a.span;
      let drawHeading = a.heading;
      let extraFog = 0;

      if (this.species === "moths") {
        drawHeading += 0.06 * Math.sin(a.phase);
      } else if (this.species === "rabbits") {
        const air = Math.max(0, Math.sin(a.phase * 0.5));
        drawY -= 0.16 * a.span * air;
        drawSpan *= 1 + 0.08 * air;
      } else if (this.species === "flyingfish") {
        const arc = a.leaping
          ? 4 * a.leapProgress * (1 - a.leapProgress) * this.tweaks.leapHeight
          : 0;
        drawSpan *= 1 + 0.35 * arc;
        if (!a.leaping) {
          extraFog = 0.22;
          drawY += Math.sin(t * 2 + a.id) * 2;
        } else if (a.leapProgress < 0.1 || a.leapProgress > 0.9) {
          extraFog = 0.1;
        }
      }

      const cos = Math.cos(drawHeading);
      const sin = Math.sin(drawHeading);
      const isSideView = this.species === "rabbits";
      const faceDir = isSideView ? (Math.cos(drawHeading) >= 0 ? 1 : -1) : 1;
      const sideTilt = isSideView
        ? clamp(Math.sin(drawHeading) * 0.35, -0.6, 0.6)
        : 0;
      const sCos = Math.cos(sideTilt);
      const sSin = Math.sin(sideTilt);

      const fog = clamp((1 - a.depth) * this.tweaks.fog + extraFog, 0, 0.95);
      const radiusPx = drawSpan * extent;
      const cMin = Math.max(0, Math.floor((drawX - radiusPx) / cw));
      const cMax = Math.min(this.cols - 1, Math.ceil((drawX + radiusPx) / cw));
      const rMin = Math.max(0, Math.floor((drawY - radiusPx) / ch));
      const rMax = Math.min(this.rows - 1, Math.ceil((drawY + radiusPx) / ch));

      const toLocal = (px: number, py: number): [number, number] => {
        const dx = (px - drawX) / drawSpan;
        const dy = (py - drawY) / drawSpan;
        if (isSideView) {
          const sx = dx * faceDir;
          return [sx * sCos + dy * sSin, -sx * sSin + dy * sCos];
        }
        return [dx * cos + dy * sin, -dx * sin + dy * cos];
      };

      const toScreen = (u: number, v: number): [number, number] => {
        if (isSideView) {
          const rx = u * sCos - v * sSin;
          const ry = u * sSin + v * sCos;
          return [drawX + rx * faceDir * drawSpan, drawY + ry * drawSpan];
        }
        return [
          drawX + (u * cos - v * sin) * drawSpan,
          drawY + (u * sin + v * cos) * drawSpan,
        ];
      };

      for (let row = rMin; row <= rMax; row++) {
        const cy = row * ch;
        for (let col = cMin; col <= cMax; col++) {
          const cx = col * cw;
          const [cu, cv] = toLocal(cx + cw * 0.5, cy + ch * 0.5);
          const centerSample = this.sampleAnimalShape(a, cu, cv);
          const pts: Array<readonly [number, number]> = [
            [0.25, 0.3],
            [0.75, 0.3],
            [0.25, 0.72],
            [0.75, 0.72],
          ];
          let hits = centerSample ? 1 : 0;
          let firstHit: ShapeSample | false = centerSample;
          for (const [fx, fy] of pts) {
            const [su, sv] = toLocal(cx + cw * fx, cy + ch * fy);
            const s = this.sampleAnimalShape(a, su, sv);
            if (s) {
              hits++;
              if (!firstHit) firstHit = s;
            }
          }
          if (!firstHit) continue;
          const coverage = hits / 5;

          const baseHue = rotateHue(firstHit.color, this.tweaks.hue);
          const lu = Math.round(cu * 14);
          const lv = Math.round(cv * 14);
          const flick =
            1 + (hash2d(a.id + flickerBucket, lu, lv) - 0.5) * 0.06;

          if (!centerSample || coverage < 0.6) {
            const edgeFade = clamp(fog + 0.55 - 0.45 * coverage, 0, 0.98);
            const edgeCol = mixRgb(baseHue, BG_RGB, edgeFade);
            const edgeSet = coverage >= 0.5 ? ":;" : ".',`";
            const gIdx = Math.floor(
              hash2d(a.id, lu, lv) * edgeSet.length
            );
            this.putCell(col, row, {
              solid: false,
              fill: "",
              glyph: edgeSet[gIdx] ?? ".",
              glyphColor: rgbStr(edgeCol),
            });
            continue;
          }

          if (firstHit.kind === "Line") {
            const c = mixRgb(baseHue, BG_RGB, fog);
            const set = firstHit.glyphs ?? RAMP_LINE;
            const gIdx = Math.floor(hash2d(a.id, lu, lv) * set.length);
            this.putCell(col, row, {
              solid: false,
              fill: "",
              glyph: set[gIdx] ?? ".",
              glyphColor: rgbStr(c),
            });
            continue;
          }

          let fillRgb = mixRgb(baseHue, BG_RGB, fog);
          if (firstHit.kind === "Shine") {
            const sh = this.tweaks.shimmer;
            const wave =
              1 -
              0.4 * sh +
              sh * Math.sin(2.2 * t + 9 * cu + 6 * cv + 2 * a.heading);
            fillRgb = [fillRgb[0] * wave, fillRgb[1] * wave, fillRgb[2] * wave];
          } else if (firstHit.kind === "Soft") {
            fillRgb = mixRgb(fillRgb, BG_RGB, Math.min(1, 0.62 + 0.38 * fog));
          } else if (firstHit.kind === "Bright") {
            fillRgb = [fillRgb[0] * 0.58, fillRgb[1] * 0.58, fillRgb[2] * 0.58];
          }
          fillRgb = [fillRgb[0] * flick, fillRgb[1] * flick, fillRgb[2] * flick];

          let glyphRgb: RGB;
          if (firstHit.kind === "Dark") {
            glyphRgb = [
              fillRgb[0] * 1.7 + 34,
              fillRgb[1] * 1.7 + 30,
              fillRgb[2] * 1.7 + 30,
            ];
          } else if (firstHit.kind === "Light") {
            glyphRgb = [fillRgb[0] * 0.4, fillRgb[1] * 0.4, fillRgb[2] * 0.4];
          } else if (firstHit.kind === "Fur") {
            glyphRgb = [
              fillRgb[0] * 1.6 + 44,
              fillRgb[1] * 1.6 + 40,
              fillRgb[2] * 1.6 + 36,
            ];
          } else if (firstHit.kind === "Soft") {
            glyphRgb = fillRgb;
          } else if (firstHit.kind === "Bright") {
            glyphRgb = [
              fillRgb[0] * 1.05 + 50,
              fillRgb[1] * 1.05 + 50,
              fillRgb[2] * 1.05 + 50,
            ];
          } else {
            glyphRgb = [fillRgb[0] * 0.42, fillRgb[1] * 0.42, fillRgb[2] * 0.42];
          }

          const charset =
            firstHit.glyphs ??
            (firstHit.kind === "Dark"
              ? "#%@"
              : firstHit.kind === "Light"
                ? "o*"
                : firstHit.kind === "Fur"
                  ? "8#@"
                  : firstHit.kind === "Bright"
                    ? ".:*"
                    : RAMP_PLAIN);

          let glyph: string;
          if (charset === RAMP_PLAIN) {
            const lum =
              (0.299 * fillRgb[0] + 0.587 * fillRgb[1] + 0.114 * fillRgb[2]) /
              255;
            const jitter = Math.round((hash2d(a.id, lu, lv) - 0.5) * 2);
            const idx = clamp(
              Math.round((1 - lum) * (charset.length - 1)) + jitter,
              0,
              charset.length - 1
            );
            glyph = charset[idx] ?? ".";
          } else {
            const idx = Math.floor(hash2d(a.id, lu, lv) * charset.length);
            glyph = charset[idx] ?? charset[0];
          }

          // Sparkle override
          let glyphColorStr = rgbStr(glyphRgb);
          const sparkleRate =
            firstHit.kind === "Shine" ||
            firstHit.kind === "Soft" ||
            firstHit.kind === "Bright"
              ? this.tweaks.sparkle
              : firstHit.kind === "Plain"
                ? this.tweaks.sparkle / 3
                : 0;
          if (
            sparkleRate > 0 &&
            hash2d(a.id + sparkleBucket, lu, lv) < sparkleRate
          ) {
            glyphColorStr =
              SPARKLE_COLORS[
                Math.floor(hash2d(a.id + sparkleBucket + 7, lu, lv) * 3)
              ];
          }

          this.putCell(col, row, {
            solid: true,
            fill: rgbStr(fillRgb),
            glyph,
            glyphColor: glyphColorStr,
          });
        }
      }

      // Species-specific line & eye-spot details
      if (this.species === "moths") {
        const antCol = mixRgb(rotateHue([214, 170, 130], this.tweaks.hue), BG_RGB, fog);
        for (const side of [-1, 1]) {
          const [sx, sy] = toScreen(0.17, side * 0.014);
          const wob = 0.02 * Math.sin(t * 4 + side);
          const [ex, ey] = toScreen(0.36, side * (0.13 + wob));
          this.drawLinePrimitive(sx, sy, ex, ey, antCol);
          if (drawSpan > 70) {
            for (const f of [0.35, 0.6, 0.85]) {
              const [bx, by] = toScreen(0.17 + 0.19 * f, side * (0.014 + 0.116 * f));
              const [tx, ty] = toScreen(0.17 + 0.19 * f - 0.02, side * (0.014 + 0.116 * f + 0.045));
              this.drawLinePrimitive(bx, by, tx, ty, antCol);
            }
          }
        }
      } else if (this.species === "rabbits") {
        const [ex, ey] = toScreen(0.2, -0.09);
        this.drawSpotPrimitive(ex, ey, [238, 224, 212], [28, 20, 22]);
      } else if (this.species === "turtles") {
        for (const side of [-1, 1]) {
          const [ex, ey] = toScreen(0.37, side * 0.045);
          this.drawSpotPrimitive(ex, ey, [180, 220, 190], [20, 32, 26]);
        }
      } else if (this.species === "squid") {
        const squeeze =
          a.phase < 0.22
            ? Math.sin(((a.phase / 0.22) * Math.PI) / 2)
            : 1 - (a.phase - 0.22) / 0.78;
        const armCol = mixRgb(rotateHue([232, 104, 168], this.tweaks.hue), BG_RGB, fog);
        const clubCol = mixRgb(rotateHue([255, 160, 204], this.tweaks.hue), BG_RGB, fog);
        for (const side of [-1, 1]) {
          const [ex, ey] = toScreen(-0.055, side * 0.06);
          this.drawSpotPrimitive(ex, ey, [255, 220, 238], [20, 10, 20]);
        }
        for (let arm = 0; arm < 8; arm++) {
          const frac = (arm - 3.5) / 3.5;
          const baseV = frac * 0.06 * (1 - 0.55 * squeeze);
          const armLen =
            0.42 * this.tweaks.armLength * (0.85 + 0.3 * hashInt(a.id * 31 + arm));
          let prev = toScreen(-0.08, baseV);
          for (let seg = 1; seg <= 6; seg++) {
            const s = seg / 6;
            const wave =
              0.035 * Math.sin(a.phase * Math.PI * 2 - 3.5 * s + 1.3 * arm) +
              a.turnRate * 0.03 * s;
            const next = toScreen(-0.08 - armLen * s, baseV * (1 + s * 0.4) + wave);
            const faded = mixRgb(armCol, BG_RGB, s * 0.45);
            this.drawLinePrimitive(prev[0], prev[1], next[0], next[1], faded);
            prev = next;
          }
        }
        const tentacleLen = 0.78 * this.tweaks.armLength;
        for (const side of [-1, 1]) {
          let prev = toScreen(-0.08, side * 0.025);
          for (let seg = 1; seg <= 8; seg++) {
            const s = seg / 8;
            const next = toScreen(
              -0.08 - tentacleLen * s,
              side * (0.025 + 0.05 * s) +
                0.04 * Math.sin(a.phase * Math.PI * 2 - 4 * s + side)
            );
            this.drawLinePrimitive(
              prev[0],
              prev[1],
              next[0],
              next[1],
              seg === 8 ? clubCol : armCol,
              seg === 8 ? "@" : undefined
            );
            prev = next;
          }
        }
      } else if (this.species === "owls") {
        const tuftCol = mixRgb(rotateHue([150, 118, 82], this.tweaks.hue), BG_RGB, fog);
        for (const side of [-1, 1]) {
          const [tx0, ty0] = toScreen(0.19, side * 0.06);
          const [tx1, ty1] = toScreen(0.26, side * 0.06);
          this.drawLinePrimitive(tx0, ty0, tx1, ty1, tuftCol, "^");
          const [ex, ey] = toScreen(0.135, side * 0.045);
          this.drawSpotPrimitive(ex, ey, [250, 186, 58], [16, 12, 10]);
        }
      } else if (this.species === "flyingfish") {
        const [ex, ey] = toScreen(0.24, -0.032);
        this.drawSpotPrimitive(ex, ey, [224, 250, 246], [14, 28, 34]);
      } else if (this.species === "eagles") {
        const talonCol = mixRgb(rotateHue([240, 190, 70], this.tweaks.hue), BG_RGB, fog);
        for (const side of [-1, 1]) {
          const [tx0, ty0] = toScreen(-0.14, side * 0.028);
          const [tx1, ty1] = toScreen(-0.22, side * 0.036);
          this.drawLinePrimitive(tx0, ty0, tx1, ty1, talonCol);
          if (drawSpan > 80) {
            const [ex, ey] = toScreen(0.225, side * Math.max(0.026, cw / drawSpan));
            this.drawSpotPrimitive(ex, ey, [240, 190, 70], [20, 18, 16]);
          }
        }
      }
    }

    // Draw trail layer (small squares, never over solid cells)
    const meta = SPECIES_MAP[this.species];
    const trailCol = rotateHue(meta.trailColor, this.tweaks.hue);
    const sqBase = Math.max(2, Math.round(0.19 * cw));
    for (let row = 0; row < this.rows; row++) {
      const yCenter = row * ch + ch * 0.6;
      const rowOff = row * this.cols;
      for (let col = 0; col < this.cols; col++) {
        const idx = rowOff + col;
        const cell = this.cellGrid[idx];
        if (cell && cell.solid) continue;
        const energy = this.trailField[idx];
        if (energy < 0.04) continue;
        const step = clamp(Math.ceil((energy / 1.2) * 6), 1, 6);
        const tw = 0.75 + 0.25 * Math.sin(5 * t + hash2d(91, col, row) * 40);
        const alpha = (0.85 * (step / 6)) * tw;
        const sz = energy > 0.6 ? sqBase + 1 : sqBase;
        ctx.fillStyle = `rgba(${Math.round(trailCol[0])},${Math.round(trailCol[1])},${Math.round(trailCol[2])},${alpha.toFixed(3)})`;
        ctx.fillRect(
          Math.round(col * cw + cw * 0.5 - sz * 0.5),
          Math.round(yCenter - sz * 0.5),
          sz,
          sz
        );
      }
    }

    // Draw cells
    const fontSize = Math.max(5, Math.round(ch * 0.74));
    ctx.font = `600 ${fontSize}px ${this.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    for (let row = 0; row < this.rows; row++) {
      const y = row * ch;
      const rowOff = row * this.cols;
      for (let col = 0; col < this.cols; col++) {
        const cell = this.cellGrid[rowOff + col];
        if (!cell) continue;
        const x = col * cw;
        if (cell.solid) {
          ctx.fillStyle = cell.fill;
          ctx.fillRect(x + 1, y + 1, Math.max(1, cw - 1), Math.max(1, ch - 1));
        }
        ctx.fillStyle = cell.glyphColor;
        ctx.fillText(cell.glyph, x + cw * 0.5, y + ch * 0.5 + 1);
      }
    }
  }
}
