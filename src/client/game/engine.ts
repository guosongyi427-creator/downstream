// Canvas rendering + hit-testing for Downstream.
// The river is drawn in a fixed logical coordinate space (360 x 560) and
// scaled to the canvas with devicePixelRatio for crisp rendering.

import type { Puzzle, Rock, Stone, Vec } from '../../shared/puzzle';
import { PUZZLE_HEIGHT, PUZZLE_WIDTH } from '../../shared/puzzle';

export type RenderState = {
  puzzle: Puzzle;
  stones: Stone[];
  /** Stones still sitting in the tray (not placed on the river). */
  trayCount: number;
  /** Live dotted preview of where the boat would go with the current stones. */
  preview: Vec[];
  /** Where the boat is right now (null when it has not launched). */
  boat: Vec | null;
  /** Boat heading in radians (for rotation). */
  boatAngle: number;
  /** Index of the rock the preview path hits, -1 if none. */
  previewHitRock: number;
  /** Whether the preview path reaches the dock. */
  previewWins: boolean;
  /** The stone currently being dragged (drawn at the pointer). */
  dragStone: Vec | null;
  /** Animation clock in ms (drives the flowing water). */
  timeMs: number;
  /** Whether the boat is currently sailing (hide the preview while it sails). */
  sailing: boolean;
};

const TAU = Math.PI * 2;

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Convert a pointer position on the canvas element to puzzle coordinates. */
export const toPuzzleCoords = (
  canvas: HTMLCanvasElement,
  clientX: number,
  clientY: number
): Vec => {
  const rect = canvas.getBoundingClientRect();
  const x = ((clientX - rect.left) / rect.width) * PUZZLE_WIDTH;
  const y = ((clientY - rect.top) / rect.height) * PUZZLE_HEIGHT;
  return { x, y };
};

/** Index of the placed stone under a point, or -1. */
export const stoneAt = (stones: Stone[], p: Vec): number => {
  for (let i = stones.length - 1; i >= 0; i--) {
    const s = stones[i];
    if (!s) continue;
    if (Math.hypot(p.x - s.x, p.y - s.y) < 22) return i;
  }
  return -1;
};

const drawWater = (ctx: CanvasRenderingContext2D, timeMs: number): void => {
  // River water: deep teal at the top fading to a lighter teal at the bottom.
  const grad = ctx.createLinearGradient(0, 0, 0, PUZZLE_HEIGHT);
  grad.addColorStop(0, '#0e7490');
  grad.addColorStop(0.55, '#14919b');
  grad.addColorStop(1, '#1ba098');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, PUZZLE_WIDTH, PUZZLE_HEIGHT);

  // Animated flow lines: soft wavy streaks drifting downstream.
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const t = timeMs / 1000;
  for (let lane = 0; lane < 7; lane++) {
    const baseX = 30 + lane * 50;
    ctx.beginPath();
    for (let y = -20; y <= PUZZLE_HEIGHT + 20; y += 14) {
      const wobble = Math.sin(y * 0.02 + lane * 1.7 + t * 0.9) * 6;
      const yy = y + ((t * 26 + lane * 47) % 90);
      const xx = baseX + wobble;
      if (y === -20) ctx.moveTo(xx, yy - 90);
      else ctx.lineTo(xx, yy - 90);
    }
    ctx.stroke();
  }
  ctx.restore();

  // Sandy banks on the left and right edges.
  for (const side of [0, PUZZLE_WIDTH]) {
    ctx.fillStyle = '#e8d9b0';
    ctx.fillRect(side === 0 ? 0 : PUZZLE_WIDTH - 14, 0, 14, PUZZLE_HEIGHT);
    ctx.fillStyle = '#d9c48f';
    ctx.fillRect(side === 0 ? 12 : PUZZLE_WIDTH - 16, 0, 4, PUZZLE_HEIGHT);
  }
  // A few tiny flowers on the banks.
  const flowers: Vec[] = [
    { x: 7, y: 70 },
    { x: 7, y: 300 },
    { x: 7, y: 470 },
    { x: PUZZLE_WIDTH - 7, y: 150 },
    { x: PUZZLE_WIDTH - 7, y: 380 },
    { x: PUZZLE_WIDTH - 7, y: 520 },
  ];
  for (const f of flowers) {
    ctx.fillStyle = '#f472b6';
    ctx.beginPath();
    ctx.arc(f.x, f.y, 3, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#fde047';
    ctx.beginPath();
    ctx.arc(f.x, f.y, 1.4, 0, TAU);
    ctx.fill();
  }
};

const drawDock = (ctx: CanvasRenderingContext2D, puzzle: Puzzle, glowing: boolean): void => {
  const { dock } = puzzle;
  // Target zone.
  ctx.save();
  ctx.setLineDash([6, 5]);
  ctx.strokeStyle = glowing ? '#4ade80' : 'rgba(255, 255, 255, 0.75)';
  ctx.lineWidth = glowing ? 3 : 2;
  ctx.beginPath();
  ctx.arc(dock.x, dock.y, dock.r, 0, TAU);
  ctx.stroke();
  ctx.restore();
  if (glowing) {
    ctx.save();
    ctx.fillStyle = 'rgba(74, 222, 128, 0.18)';
    ctx.beginPath();
    ctx.arc(dock.x, dock.y, dock.r, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  // Wooden dock planks.
  ctx.save();
  ctx.translate(dock.x, dock.y);
  ctx.fillStyle = '#8d5a2b';
  ctx.strokeStyle = '#6b4423';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(-20, -9, 40, 18, 4);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = 'rgba(107, 68, 35, 0.7)';
  ctx.beginPath();
  ctx.moveTo(-7, -9);
  ctx.lineTo(-7, 9);
  ctx.moveTo(7, -9);
  ctx.lineTo(7, 9);
  ctx.stroke();
  // Flag.
  ctx.strokeStyle = '#5b3a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(14, -9);
  ctx.lineTo(14, -26);
  ctx.stroke();
  ctx.fillStyle = '#f97316';
  ctx.beginPath();
  ctx.moveTo(14, -26);
  ctx.lineTo(26, -22);
  ctx.lineTo(14, -18);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const drawRock = (ctx: CanvasRenderingContext2D, rock: Rock, danger: boolean): void => {
  ctx.save();
  ctx.translate(rock.x, rock.y);
  // Soft shadow.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.beginPath();
  ctx.ellipse(2, 3, rock.r, rock.r * 0.85, 0, 0, TAU);
  ctx.fill();
  // Slate body.
  ctx.fillStyle = danger ? '#7f1d1d' : '#475569';
  ctx.beginPath();
  ctx.ellipse(0, 0, rock.r, rock.r * 0.88, -0.3, 0, TAU);
  ctx.fill();
  // Highlight.
  ctx.fillStyle = danger ? '#b91c1c' : '#64748b';
  ctx.beginPath();
  ctx.ellipse(-rock.r * 0.25, -rock.r * 0.3, rock.r * 0.45, rock.r * 0.3, -0.3, 0, TAU);
  ctx.fill();
  if (danger) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-7, -7);
    ctx.lineTo(7, 7);
    ctx.moveTo(7, -7);
    ctx.lineTo(-7, 7);
    ctx.stroke();
  }
  ctx.restore();
};

const drawStone = (
  ctx: CanvasRenderingContext2D,
  stone: Stone,
  opts: { active: boolean; showInfluence: boolean }
): void => {
  if (opts.showInfluence) {
    ctx.save();
    ctx.setLineDash([4, 6]);
    ctx.strokeStyle = opts.active ? 'rgba(255, 255, 255, 0.9)' : 'rgba(255, 255, 255, 0.45)';
    ctx.lineWidth = opts.active ? 2 : 1.5;
    ctx.beginPath();
    ctx.arc(stone.x, stone.y, stone.influence, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(stone.x, stone.y);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
  ctx.beginPath();
  ctx.ellipse(2, 3, 17, 14, 0, 0, TAU);
  ctx.fill();
  ctx.fillStyle = '#b8a88a';
  ctx.strokeStyle = '#8a7a5f';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(0, 0, 16, 13, 0.2, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = '#d6c9a8';
  ctx.beginPath();
  ctx.ellipse(-4, -4, 6, 4.5, 0.2, 0, TAU);
  ctx.fill();
  ctx.restore();
};

/** An origami paper boat, pointing along `angle` (0 = down). */
const drawBoat = (ctx: CanvasRenderingContext2D, pos: Vec, angle: number): void => {
  ctx.save();
  ctx.translate(pos.x, pos.y);
  ctx.rotate(angle);
  // Soft shadow on the water.
  ctx.fillStyle = 'rgba(0, 0, 0, 0.18)';
  ctx.beginPath();
  ctx.ellipse(1, 3, 12, 7, 0, 0, TAU);
  ctx.fill();
  // Hull (white paper).
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#cbd5e1';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 11);
  ctx.lineTo(-11, -4);
  ctx.lineTo(11, -4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // Sail / fold.
  ctx.fillStyle = '#fde68a';
  ctx.beginPath();
  ctx.moveTo(0, 11);
  ctx.lineTo(0, -13);
  ctx.lineTo(9, -4);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 1;
  ctx.stroke();
  // Fold line.
  ctx.strokeStyle = '#94a3b8';
  ctx.beginPath();
  ctx.moveTo(0, 11);
  ctx.lineTo(0, -4);
  ctx.stroke();
  ctx.restore();
};

const drawPreview = (
  ctx: CanvasRenderingContext2D,
  preview: Vec[],
  wins: boolean
): void => {
  if (preview.length < 2) return;
  const first = preview[0];
  if (!first) return;
  ctx.save();
  ctx.setLineDash([2, 7]);
  ctx.lineCap = 'round';
  ctx.strokeStyle = wins ? '#4ade80' : 'rgba(255, 255, 255, 0.95)';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < preview.length; i++) {
    const p = preview[i];
    if (!p) continue;
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  ctx.restore();
};

export const render = (canvas: HTMLCanvasElement, state: RenderState): void => {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = PUZZLE_WIDTH;
  const cssH = PUZZLE_HEIGHT;
  if (canvas.width !== cssW * dpr || canvas.height !== cssH * dpr) {
    canvas.width = cssW * dpr;
    canvas.height = cssH * dpr;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const { puzzle, stones, preview, boat, dragStone, sailing } = state;

  drawWater(ctx, state.timeMs);

  // Launch marker.
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(puzzle.launch.x, puzzle.launch.y, 12, 0, TAU);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
  ctx.font = '600 10px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('START', puzzle.launch.x, puzzle.launch.y - 18);

  drawDock(ctx, puzzle, state.previewWins && !sailing);

  for (let i = 0; i < puzzle.rocks.length; i++) {
    const rock = puzzle.rocks[i];
    if (!rock) continue;
    drawRock(ctx, rock, state.previewHitRock === i && !sailing);
  }

  // Dotted preview of the boat's path (hidden while it sails).
  if (!sailing && preview.length > 1) {
    drawPreview(ctx, preview, state.previewWins);
  }

  for (const s of stones) drawStone(ctx, s, { active: false, showInfluence: true });

  // The stone being dragged, drawn at the pointer.
  if (dragStone) {
    drawStone(
      ctx,
      { x: dragStone.x, y: dragStone.y, influence: 70, strength: 2.6 },
      { active: true, showInfluence: true }
    );
  }

  // The boat.
  if (boat) {
    drawBoat(ctx, boat, state.boatAngle);
  } else {
    // Parked at the launch point before the first launch.
    drawBoat(ctx, puzzle.launch, 0);
  }

  // Tray hint: how many stones are left to place.
  if (state.trayCount > 0 && !sailing) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(`Stones left: ${state.trayCount} — drag one onto the river`, 20, PUZZLE_HEIGHT - 8);
  }
};

/** Clamp a point into the river area (keeps stones off the banks and the dock). */
export const clampToRiver = (puzzle: Puzzle, p: Vec): Vec => ({
  x: clamp(p.x, 22, puzzle.width - 22),
  y: clamp(p.y, 40, puzzle.height - 90),
});
