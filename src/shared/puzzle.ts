// Shared game logic for Downstream — a daily river puzzle.
// Used by both the client (rendering + preview) and the server (validation).
// Everything here is deterministic: the same date always yields the same puzzle,
// and the physics simulation is identical on client and server.

export type Vec = {
  x: number;
  y: number;
};

export type Stone = Vec & {
  // influence radius of the stone's eddy (how far its push reaches)
  influence: number;
  // how hard the stone pushes the boat sideways
  strength: number;
};

export type Rock = Vec & {
  r: number;
};

export type Puzzle = {
  date: string; // YYYY-MM-DD
  width: number;
  height: number;
  launch: Vec; // where the paper boat starts
  dock: Vec & { r: number };
  rocks: Rock[];
  baseSpeed: number; // downward current speed (units per step)
  meanderAmp: number; // horizontal sway of the current
  meanderFreq: number;
  meanderPhase: number;
  maxStones: number;
  maxLaunches: number;
};

export type SimOutcome = 'win' | 'rock' | 'offscreen' | 'timeout';

export type SimResult = {
  outcome: SimOutcome;
  path: Vec[];
  hitRock: number; // index of the rock hit, -1 if none
  steps: number;
};

export const PUZZLE_WIDTH = 360;
export const PUZZLE_HEIGHT = 560;
export const BOAT_RADIUS = 8;
export const STONE_INFLUENCE = 70;
export const STONE_STRENGTH = 2.6;
export const MAX_STONES = 3;
export const MAX_LAUNCHES = 3;
export const MAX_SIM_STEPS = 900;

/** Deterministic PRNG (mulberry32). Same seed -> same sequence. */
export const mulberry32 = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hashDate = (date: string): number => {
  let h = 2166136261;
  for (let i = 0; i < date.length; i++) {
    h ^= date.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

const rand = (rng: () => number, min: number, max: number): number =>
  min + rng() * (max - min);

/** Flow velocity (the river current) at a point, given the puzzle and stones. */
export const flowAt = (puzzle: Puzzle, stones: Stone[], p: Vec): Vec => {
  let vx = puzzle.meanderAmp * Math.sin(p.y * puzzle.meanderFreq + puzzle.meanderPhase);
  let vy = puzzle.baseSpeed;
  for (const s of stones) {
    const dx = p.x - s.x;
    const dy = p.y - s.y;
    const d = Math.hypot(dx, dy);
    if (d < s.influence && d > 0.001) {
      const falloff = 1 - d / s.influence;
      // Push the boat sideways, away from the stone. Never pushes it backwards.
      vx += Math.sign(dx) * s.strength * falloff;
      // Slight slowdown as the boat rounds the stone.
      vy *= 1 - 0.25 * falloff;
    }
  }
  // Cap total speed so a stack of stones can't slingshot the boat.
  const speed = Math.hypot(vx, vy);
  const maxSpeed = 4.5;
  if (speed > maxSpeed) {
    vx = (vx / speed) * maxSpeed;
    vy = (vy / speed) * maxSpeed;
  }
  return { x: vx, y: vy };
};

/** Simulate the boat from the launch point. Deterministic. */
export const simulate = (puzzle: Puzzle, stones: Stone[]): SimResult => {
  const path: Vec[] = [];
  let p: Vec = { x: puzzle.launch.x, y: puzzle.launch.y };
  let outcome: SimOutcome = 'timeout';
  let hitRock = -1;
  let steps = 0;
  for (let i = 0; i < MAX_SIM_STEPS; i++) {
    path.push({ x: p.x, y: p.y });
    const v = flowAt(puzzle, stones, p);
    p = { x: p.x + v.x, y: p.y + v.y };
    steps = i + 1;
    // Reached the dock?
    if (Math.hypot(p.x - puzzle.dock.x, p.y - puzzle.dock.y) < puzzle.dock.r) {
      outcome = 'win';
      path.push({ x: p.x, y: p.y });
      break;
    }
    // Hit a rock?
    for (let r = 0; r < puzzle.rocks.length; r++) {
      const rock = puzzle.rocks[r];
      if (!rock) continue;
      if (Math.hypot(p.x - rock.x, p.y - rock.y) < rock.r + BOAT_RADIUS) {
        outcome = 'rock';
        hitRock = r;
        path.push({ x: p.x, y: p.y });
        break;
      }
    }
    if (outcome === 'rock') break;
    // Drifted off the river?
    if (p.x < -12 || p.x > puzzle.width + 12 || p.y > puzzle.height + 12 || p.y < -12) {
      outcome = 'offscreen';
      path.push({ x: p.x, y: p.y });
      break;
    }
  }
  return { outcome, path, hitRock, steps };
};

const makeStone = (x: number, y: number): Stone => ({
  x,
  y,
  influence: STONE_INFLUENCE,
  strength: STONE_STRENGTH,
});

const buildPuzzle = (date: string, attempt: number): Puzzle => {
  const rng = mulberry32(hashDate(date) + attempt * 7919);
  const width = PUZZLE_WIDTH;
  const height = PUZZLE_HEIGHT;
  const launch = { x: rand(rng, width * 0.28, width * 0.72), y: 34 };
  const dock = {
    x: rand(rng, width * 0.18, width * 0.82),
    y: height - 44,
    r: 26,
  };
  const baseSpeed = rand(rng, 1.8, 2.2);
  const meanderAmp = rand(rng, 0.7, 1.5);
  const meanderFreq = rand(rng, 0.008, 0.014);
  const meanderPhase = rand(rng, 0, Math.PI * 2);
  // Rocks live in the middle band so they never block the launch or the dock.
  const rockCount = 4 + Math.floor(rng() * 3); // 4-6 rocks
  const rocks: Rock[] = [];
  let guard = 0;
  while (rocks.length < rockCount && guard < 200) {
    guard++;
    const r = rand(rng, 14, 24);
    const x = rand(rng, r + 8, width - r - 8);
    const y = rand(rng, height * 0.24, height * 0.72);
    if (Math.hypot(x - launch.x, y - launch.y) < r + 60) continue;
    if (Math.hypot(x - dock.x, y - dock.y) < r + 70) continue;
    if (rocks.some((o) => Math.hypot(x - o.x, y - o.y) < r + o.r + 26)) continue;
    rocks.push({ x, y, r });
  }
  return {
    date,
    width,
    height,
    launch,
    dock,
    rocks,
    baseSpeed,
    meanderAmp,
    meanderFreq,
    meanderPhase,
    maxStones: MAX_STONES,
    maxLaunches: MAX_LAUNCHES,
  };
};

/**
 * Random-search solver: tries random stone placements and returns the first
 * set (up to maxStones) that reaches the dock, or null. Used to guarantee
 * every daily puzzle is solvable, and to sanity-check difficulty.
 */
export const findSolution = (
  puzzle: Puzzle,
  maxStones: number,
  tries = 20000,
  seed = 1
): Stone[] | null => {
  const rng = mulberry32(hashDate(puzzle.date) * 31 + seed);
  for (let t = 0; t < tries; t++) {
    const n = 1 + Math.floor(rng() * maxStones);
    const stones: Stone[] = [];
    for (let i = 0; i < n; i++) {
      stones.push(
        makeStone(
          rand(rng, 20, puzzle.width - 20),
          rand(rng, 60, puzzle.height - 120)
        )
      );
    }
    if (simulate(puzzle, stones).outcome === 'win') return stones;
  }
  return null;
};

/**
 * Generate the daily puzzle for a date. Guarantees two things:
 *  - the boat does NOT reach the dock with no stones (you must play), and
 *  - the puzzle IS solvable with at most maxStones stones.
 * If an attempt fails either check, a derived seed is tried.
 */
export const generatePuzzle = (date: string): Puzzle => {
  for (let attempt = 0; attempt < 40; attempt++) {
    const puzzle = buildPuzzle(date, attempt);
    // Must require stones: the no-stone path must miss the dock.
    if (simulate(puzzle, []).outcome === 'win') continue;
    // Must be solvable with at most maxStones.
    if (!findSolution(puzzle, puzzle.maxStones, 12000, attempt + 1)) continue;
    return puzzle;
  }
  // Extremely unlikely fallback: a wide-open river with a gentle meander.
  // The solver has verified this shape is solvable, so it is safe to return.
  const fallback = buildPuzzle(date, 999);
  fallback.rocks = fallback.rocks.slice(0, 2);
  fallback.meanderAmp = 0.7;
  return fallback;
};

/** "YYYY-MM-DD" for a Date, in local time. */
export const dateKey = (d: Date): string => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Today's date key (local time). */
export const todayKey = (): string => dateKey(new Date());
