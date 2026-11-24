import './index.css';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { createRoot } from 'react-dom/client';
import { showToast } from '@devvit/web/client';
import type { InitResponse, LeaderboardEntry } from '../shared/api';
import {
  generatePuzzle,
  simulate,
  todayKey,
  type Puzzle,
  type Stone,
  type Vec,
} from '../shared/puzzle';
import { clampToRiver, render, stoneAt, toPuzzleCoords } from './game/engine';

type Phase = 'placing' | 'sailing' | 'won' | 'lost';

type GameState = {
  puzzle: Puzzle;
  stones: Stone[];
  phase: Phase;
  launchesUsed: number;
  streak: number;
  solvedToday: boolean;
  bestLaunchesToday: number | null;
  leaderboard: LeaderboardEntry[];
  localMode: boolean;
  practice: boolean;
  startedAt: number;
};

const PREVIEW_FRACTION = 0.55; // the live preview shows only the first 55% of the path
const TAP_SLOP = 8; // pointer movement (px, puzzle units) that still counts as a tap

const truncatePath = (path: Vec[], maxY: number): Vec[] => {
  const out: Vec[] = [];
  for (const p of path) {
    if (p.y > maxY) break;
    out.push(p);
  }
  return out;
};

type LocalSave = { streak: number; solved: boolean; best: number | null };

const loadLocalSave = (date: string): LocalSave => {
  try {
    const raw = localStorage.getItem(`downstream:${date}`);
    if (raw) return JSON.parse(raw) as LocalSave;
  } catch {
    // ignore corrupt local state
  }
  return { streak: 0, solved: false, best: null };
};

const saveLocalSave = (date: string, data: LocalSave): void => {
  try {
    localStorage.setItem(`downstream:${date}`, JSON.stringify(data));
  } catch {
    // storage may be unavailable in the webview
  }
};

const shareText = (date: string, launches: number, streak: number, won: boolean): string => {
  const boats = won ? '⛵'.repeat(launches) : '💧';
  const d = new Date(`${date}T12:00:00`);
  const label = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `Downstream ${label} — ${boats} ${
    won ? `solved in ${launches} launch${launches > 1 ? 'es' : ''}` : 'not today'
  } 🔥 ${streak}-day streak`;
};

export const App = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [drag, setDrag] = useState<{ fromTray: boolean; index: number; pos: Vec; start: Vec } | null>(null);
  const [boat, setBoat] = useState<Vec | null>(null);
  const [boatAngle, setBoatAngle] = useState(0);
  const [loading, setLoading] = useState(true);

  // Refs mirror the latest values so the animation loop never reads stale state.
  // Synced in an effect (not during render) to satisfy the react-hooks lint rule.
  const stateRef = useRef<GameState | null>(null);
  const dragRef = useRef<typeof drag>(null);
  const boatRef = useRef<Vec | null>(null);
  const boatAngleRef = useRef(0);
  const sailRef = useRef<{ path: Vec[]; i: number } | null>(null);
  useEffect(() => {
    stateRef.current = state;
    dragRef.current = drag;
    boatRef.current = boat;
    boatAngleRef.current = boatAngle;
  });

  // ---- init: try the server, fall back to local play ----
  useEffect(() => {
    const init = async () => {
      const date = todayKey();
      try {
        const res = await fetch('/api/init');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: InitResponse = await res.json();
        if (data.type !== 'init') throw new Error('Unexpected response');
        setState({
          puzzle: data.puzzle,
          stones: [],
          phase: data.solvedToday ? 'won' : 'placing',
          launchesUsed: 0,
          streak: data.streak,
          solvedToday: data.solvedToday,
          bestLaunchesToday: data.bestLaunchesToday,
          leaderboard: data.leaderboard,
          localMode: data.localMode,
          practice: data.solvedToday,
          startedAt: Date.now(),
        });
      } catch {
        const local = loadLocalSave(date);
        setState({
          puzzle: generatePuzzle(date),
          stones: [],
          phase: local.solved ? 'won' : 'placing',
          launchesUsed: 0,
          streak: local.streak,
          solvedToday: local.solved,
          bestLaunchesToday: local.best,
          leaderboard: [],
          localMode: true,
          practice: local.solved,
          startedAt: Date.now(),
        });
      } finally {
        setLoading(false);
      }
    };
    void init();
  }, []);

  // ---- live preview (first 55% of the path) ----
  const preview = useMemo(() => {
    if (!state) return { path: [] as Vec[], wins: false, hitRock: -1 };
    const result = simulate(state.puzzle, state.stones);
    return {
      path: truncatePath(result.path, state.puzzle.height * PREVIEW_FRACTION),
      wins: result.outcome === 'win',
      hitRock: result.hitRock,
    };
  }, [state]);
  const previewRef = useRef(preview);
  useEffect(() => {
    previewRef.current = preview;
  }, [preview]);

  // ---- resolve a finished sail ----
  const finishSail = useCallback(async () => {
    const s = stateRef.current;
    if (!s) return;
    const result = simulate(s.puzzle, s.stones);
    const launchesUsed = s.launchesUsed + 1;
    const timeMs = Date.now() - s.startedAt;
    if (result.outcome === 'win') {
      if (!s.practice) {
        if (s.localMode) {
          const prev = loadLocalSave(s.puzzle.date);
          const streak = prev.streak + 1;
          saveLocalSave(s.puzzle.date, { streak, solved: true, best: launchesUsed });
          setState((cur) =>
            cur
              ? { ...cur, phase: 'won', launchesUsed, streak, solvedToday: true, bestLaunchesToday: launchesUsed }
              : cur
          );
        } else {
          try {
            const res = await fetch('/api/complete', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ won: true, launchesUsed, timeMs }),
            });
            const data = await res.json();
            setState((cur) =>
              cur
                ? {
                    ...cur,
                    phase: 'won',
                    launchesUsed,
                    streak: typeof data.streak === 'number' ? data.streak : cur.streak,
                    solvedToday: true,
                    bestLaunchesToday:
                      typeof data.bestLaunchesToday === 'number' ? data.bestLaunchesToday : launchesUsed,
                    leaderboard: Array.isArray(data.leaderboard) ? data.leaderboard : cur.leaderboard,
                  }
                : cur
            );
          } catch {
            setState((cur) => (cur ? { ...cur, phase: 'won', launchesUsed, solvedToday: true } : cur));
          }
        }
      } else {
        setState((cur) => (cur ? { ...cur, phase: 'won', launchesUsed } : cur));
      }
      return;
    }
    // A failed launch: the boat resets, the stones stay, try again.
    setBoat(null);
    setBoatAngle(0);
    if (s.practice) {
      setState((cur) => (cur ? { ...cur, phase: 'placing' } : cur));
      return;
    }
    if (launchesUsed >= s.puzzle.maxLaunches) {
      if (s.localMode) {
        saveLocalSave(s.puzzle.date, { streak: 0, solved: false, best: null });
        setState((cur) => (cur ? { ...cur, phase: 'lost', launchesUsed, streak: 0 } : cur));
      } else {
        try {
          const res = await fetch('/api/complete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ won: false, launchesUsed, timeMs }),
          });
          const data = await res.json();
          setState((cur) =>
            cur
              ? {
                  ...cur,
                  phase: 'lost',
                  launchesUsed,
                  streak: typeof data.streak === 'number' ? data.streak : 0,
                  leaderboard: Array.isArray(data.leaderboard) ? data.leaderboard : cur.leaderboard,
                }
              : cur
          );
        } catch {
          setState((cur) => (cur ? { ...cur, phase: 'lost', launchesUsed, streak: 0 } : cur));
        }
      }
    } else {
      setState((cur) => (cur ? { ...cur, phase: 'placing', launchesUsed } : cur));
    }
  }, []);
  const finishSailRef = useRef(finishSail);
  useEffect(() => {
    finishSailRef.current = finishSail;
  }, [finishSail]);

  // ---- render + animation loop (runs once, reads refs) ----
  useEffect(() => {
    let raf = 0;
    const loop = (t: number) => {
      const canvas = canvasRef.current;
      const s = stateRef.current;
      if (canvas && s) {
        const sailing = sailRef.current !== null;
        const pv = previewRef.current;
        render(canvas, {
          puzzle: s.puzzle,
          stones: s.stones,
          trayCount: s.puzzle.maxStones - s.stones.length,
          preview: s.phase === 'placing' && !sailing ? pv.path : [],
          boat: boatRef.current,
          boatAngle: boatAngleRef.current,
          previewHitRock: pv.hitRock,
          previewWins: pv.wins,
          dragStone: dragRef.current ? dragRef.current.pos : null,
          timeMs: t,
          sailing,
        });
        if (sailRef.current) {
          const sail = sailRef.current;
          sail.i = Math.min(sail.i + 3, sail.path.length - 1);
          const p = sail.path[sail.i];
          const prev = sail.path[Math.max(0, sail.i - 1)];
          if (p && prev) {
            setBoat(p);
            setBoatAngle(Math.atan2(p.y - prev.y, p.x - prev.x) + Math.PI / 2);
          }
          if (sail.i >= sail.path.length - 1) {
            sailRef.current = null;
            void finishSailRef.current();
          }
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const launch = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.phase !== 'placing' || sailRef.current) return;
    const result = simulate(s.puzzle, s.stones);
    setState((cur) => (cur ? { ...cur, phase: 'sailing' } : cur));
    setBoat(s.puzzle.launch);
    setBoatAngle(0);
    sailRef.current = { path: result.path, i: 0 };
  }, []);

  const resetStones = useCallback(() => {
    const s = stateRef.current;
    if (!s || s.phase !== 'placing') return;
    setState((cur) => (cur ? { ...cur, stones: [] } : cur));
  }, []);

  const playAgainPractice = useCallback(() => {
    setState((cur) =>
      cur
        ? { ...cur, phase: 'placing', stones: [], launchesUsed: 0, practice: true, startedAt: Date.now() }
        : cur
    );
    setBoat(null);
    setBoatAngle(0);
  }, []);

  const share = useCallback(async () => {
    const s = stateRef.current;
    if (!s) return;
    const text = shareText(
      s.puzzle.date,
      s.bestLaunchesToday ?? s.launchesUsed,
      s.streak,
      s.phase === 'won'
    );
    try {
      await navigator.clipboard.writeText(text);
      showToast('Result copied — paste it in the comments!');
    } catch {
      showToast(text);
    }
  }, []);

  // ---- pointer handling: drag stones, tap a placed stone to remove it ----
  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = stateRef.current;
    if (!s || s.phase !== 'placing') return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = toPuzzleCoords(canvas, e.clientX, e.clientY);
    const idx = stoneAt(s.stones, p);
    if (idx >= 0) {
      const stone = s.stones[idx];
      if (!stone) return;
      const d = { fromTray: false, index: idx, pos: { x: stone.x, y: stone.y }, start: p };
      setDrag(d);
      dragRef.current = d;
    } else if (s.stones.length < s.puzzle.maxStones) {
      const d = { fromTray: true, index: -1, pos: clampToRiver(s.puzzle, p), start: p };
      setDrag(d);
      dragRef.current = d;
    }
    canvas.setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLCanvasElement>) => {
    const s = stateRef.current;
    const d = dragRef.current;
    if (!d || !s) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const p = clampToRiver(s.puzzle, toPuzzleCoords(canvas, e.clientX, e.clientY));
    const next = { ...d, pos: p };
    setDrag(next);
    dragRef.current = next;
  }, []);

  const onPointerUp = useCallback(() => {
    const s = stateRef.current;
    const d = dragRef.current;
    if (!d || !s) return;
    const moved = Math.hypot(d.pos.x - d.start.x, d.pos.y - d.start.y);
    if (!d.fromTray && moved < TAP_SLOP) {
      // A tap on a placed stone sends it back to the tray.
      setState((cur) => {
        if (!cur) return cur;
        const stones = [...cur.stones];
        stones.splice(d.index, 1);
        return { ...cur, stones };
      });
    } else if (d.fromTray) {
      setState((cur) =>
        cur
          ? { ...cur, stones: [...cur.stones, { x: d.pos.x, y: d.pos.y, influence: 70, strength: 2.6 }] }
          : cur
      );
    } else {
      setState((cur) => {
        if (!cur) return cur;
        const stones = [...cur.stones];
        const existing = stones[d.index];
        if (!existing) return cur;
        stones[d.index] = { ...existing, x: d.pos.x, y: d.pos.y };
        return { ...cur, stones };
      });
    }
    setDrag(null);
    dragRef.current = null;
  }, []);

  if (loading || !state) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#0e7490]">
        <p className="text-lg text-white">Loading the river…</p>
      </div>
    );
  }

  const dateLabel = new Date(`${state.puzzle.date}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  const launchesLeft = state.puzzle.maxLaunches - state.launchesUsed;
  const endPhase = state.phase === 'won' || state.phase === 'lost';

  return (
    <div className="flex min-h-screen flex-col bg-[#f7f3e8] text-[#1f2937]">
      <header className="flex items-center justify-between px-4 pt-3 pb-1">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight">Downstream</h1>
          <p className="text-xs text-[#6b7280]">{dateLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-white px-3 py-1 text-sm font-bold shadow-sm">🔥 {state.streak}</span>
          <span className="rounded-full bg-white px-3 py-1 text-sm font-bold shadow-sm">
            ⛵ {launchesLeft} left
          </span>
        </div>
      </header>

      <main className="flex flex-1 flex-col items-center px-3 pb-4">
        <div className="relative w-full max-w-[420px]">
          <canvas
            ref={canvasRef}
            className="block w-full touch-none rounded-2xl shadow-lg"
            style={{ aspectRatio: '360 / 560' }}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          />
          {state.phase === 'placing' && (
            <p className="mt-2 text-center text-sm text-[#6b7280]">
              Drag a stone onto the river to bend the current, then launch the boat. The dotted line shows the
              first part of the journey — the rest is up to the river. Tap a stone to take it back.
            </p>
          )}
        </div>

        {state.phase === 'placing' && (
          <div className="mt-3 flex w-full max-w-[420px] gap-2">
            <button
              className="flex-1 rounded-full bg-[#f97316] py-3 text-base font-bold text-white shadow-md transition-colors hover:bg-[#ea580c] disabled:opacity-40"
              onClick={launch}
              disabled={state.stones.length === 0}
            >
              Launch the boat ⛵
            </button>
            <button
              className="rounded-full bg-white px-4 py-3 text-sm font-bold shadow-md transition-colors hover:bg-[#f3f4f6] disabled:opacity-40"
              onClick={resetStones}
              disabled={state.stones.length === 0}
            >
              Reset stones
            </button>
          </div>
        )}

        {state.phase === 'sailing' && (
          <p className="mt-3 text-center text-sm font-semibold text-[#0e7490]">The boat is on its way…</p>
        )}

        {endPhase && (
          <div className="mt-3 w-full max-w-[420px] rounded-2xl bg-white p-4 shadow-lg">
            <h2 className="text-center text-xl font-extrabold">
              {state.phase === 'won'
                ? 'You made it to the dock! 🎉'
                : 'Out of launches — the river wins today.'}
            </h2>
            <p className="mt-1 text-center text-sm text-[#6b7280]">
              {state.phase === 'won'
                ? `Solved in ${state.bestLaunchesToday ?? state.launchesUsed} launch${
                    (state.bestLaunchesToday ?? state.launchesUsed) > 1 ? 'es' : ''
                  } · 🔥 ${state.streak}-day streak`
                : 'Come back tomorrow for a brand-new river.'}
            </p>
            {state.leaderboard.length > 0 && (
              <div className="mt-3 rounded-xl bg-[#f7f3e8] p-3">
                <h3 className="text-sm font-bold">Today&apos;s best</h3>
                <ol className="mt-1 space-y-1 text-sm">
                  {state.leaderboard.slice(0, 5).map((e, i) => (
                    <li key={e.username} className="flex justify-between">
                      <span>
                        {i + 1}. {e.username}
                      </span>
                      <span className="font-semibold">
                        {e.launches} launch{e.launches > 1 ? 'es' : ''}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="mt-3 flex gap-2">
              <button
                className="flex-1 rounded-full bg-[#0e7490] py-2.5 text-sm font-bold text-white shadow-md hover:bg-[#155e75]"
                onClick={share}
              >
                Share result
              </button>
              <button
                className="flex-1 rounded-full bg-white py-2.5 text-sm font-bold shadow-md hover:bg-[#f3f4f6]"
                onClick={playAgainPractice}
              >
                Play again (practice)
              </button>
            </div>
            <p className="mt-2 text-center text-xs text-[#9ca3af]">
              {state.localMode
                ? 'Playing locally — streaks are saved on this device.'
                : 'How did you steer the boat? Tell us in the comments!'}
            </p>
          </div>
        )}
      </main>

      <footer className="pb-3 text-center text-[11px] text-[#9ca3af]">
        Downstream — a daily river puzzle · a new river every day · r/DownstreamGame
      </footer>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<App />);
