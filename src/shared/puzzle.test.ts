import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  dateKey,
  findSolution,
  generatePuzzle,
  simulate,
  type Puzzle,
} from './puzzle.ts';

// Every daily puzzle must (a) require stones to win and (b) be solvable with
// at most maxStones. We verify this across a two-month window so no player
// ever gets an impossible (or trivial) river.
describe('generatePuzzle', () => {
  it('produces solvable, non-trivial puzzles for Dec 2026 - Jan 2027', () => {
    const failures: string[] = [];
    const start = new Date('2026-12-01T12:00:00Z');
    for (let d = 0; d < 62; d++) {
      const day = new Date(start);
      day.setUTCDate(start.getUTCDate() + d);
      const key = dateKey(day);
      const puzzle: Puzzle = generatePuzzle(key);
      // (a) The boat must NOT reach the dock with no stones.
      const natural = simulate(puzzle, []);
      if (natural.outcome === 'win') {
        failures.push(`${key}: winnable with no stones`);
        continue;
      }
      // (b) It must be solvable with at most maxStones.
      const solution = findSolution(puzzle, puzzle.maxStones, 30000, 7);
      if (!solution) {
        failures.push(`${key}: no solution found with ${puzzle.maxStones} stones`);
        continue;
      }
      // The solution must actually win when simulated.
      const check = simulate(puzzle, solution);
      assert.equal(check.outcome, 'win', `${key}: solver solution did not win`);
      assert.ok(
        solution.length <= puzzle.maxStones,
        `${key}: solution uses ${solution.length} stones`
      );
    }
    assert.deepEqual(failures, [], `unsolvable/trivial puzzles: ${failures.join('; ')}`);
  });

  it('is deterministic: the same date always yields the same puzzle', () => {
    const a = generatePuzzle('2026-12-08');
    const b = generatePuzzle('2026-12-08');
    assert.deepEqual(a, b);
  });

  it('produces different puzzles on different dates', () => {
    const a = generatePuzzle('2026-12-08');
    const b = generatePuzzle('2026-12-09');
    assert.notDeepEqual(a.launch, b.launch);
  });

  it('simulation is deterministic', () => {
    const puzzle = generatePuzzle('2026-12-08');
    const solution = findSolution(puzzle, puzzle.maxStones, 30000, 7);
    assert.ok(solution);
    const r1 = simulate(puzzle, solution);
    const r2 = simulate(puzzle, solution);
    assert.deepEqual(r1, r2);
  });
});
