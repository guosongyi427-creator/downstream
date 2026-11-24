import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import { generatePuzzle } from '../../shared/puzzle';
import type {
  CompleteRequest,
  CompleteResponse,
  ErrorResponse,
  InitResponse,
  LeaderboardEntry,
  LeaderboardResponse,
} from '../../shared/api';

// Server-side state lives in Devvit Redis.
//  - user:{username}:lastPlayed -> "YYYY-MM-DD" of the last day the user played
//  - user:{username}:streak     -> current streak (consecutive days solved)
//  - user:{username}:best:{date} -> fewest launches used to solve that date
//  - lb:{postId}:{date}         -> sorted set, member = username,
//                                 score = launches * 1e12 + timeMs (lower is better)
// The daily puzzle is the same for everyone: it is generated from the UTC date.

const LB_FACTOR = 1e12;

const utcDateKey = (d: Date): string => {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const addDays = (date: string, delta: number): string => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return utcDateKey(d);
};

const lbScore = (launches: number, timeMs: number): number =>
  launches * LB_FACTOR + Math.min(Math.max(Math.floor(timeMs), 0), LB_FACTOR - 1);

const decodeLb = (member: string, score: number): LeaderboardEntry => ({
  username: member,
  launches: Math.floor(score / LB_FACTOR),
  timeMs: Math.floor(score % LB_FACTOR),
});

const leaderboardFor = async (postId: string, date: string): Promise<LeaderboardEntry[]> => {
  const rows = await redis.zRange(`lb:${postId}:${date}`, 0, 4, { by: 'rank' });
  return rows.map((r) => decodeLb(r.member, r.score));
};

const toInt = (v: string | undefined): number | null => {
  if (v === undefined) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
};

export const api = new Hono();

api.get('/init', async (c) => {
  const { postId } = context;
  const date = utcDateKey(new Date());
  const puzzle = generatePuzzle(date);

  // Without a post context we cannot persist anything; let the client play locally.
  if (!postId) {
    return c.json<InitResponse>({
      type: 'init',
      postId: '',
      username: 'you',
      date,
      puzzle,
      streak: 0,
      solvedToday: false,
      bestLaunchesToday: null,
      leaderboard: [],
      localMode: true,
    });
  }

  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const [lastPlayed, streakRaw, bestRaw] = await Promise.all([
      redis.get(`user:${username}:lastPlayed`),
      redis.get(`user:${username}:streak`),
      redis.get(`user:${username}:best:${date}`),
    ]);
    const storedStreak = toInt(streakRaw) ?? 0;
    const best = toInt(bestRaw);
    let streak = 0;
    if (lastPlayed === date) {
      streak = storedStreak;
    } else if (lastPlayed === addDays(date, -1)) {
      streak = storedStreak; // alive: it grows when today's puzzle is solved
    } else {
      streak = 0;
    }
    const leaderboard = await leaderboardFor(postId, date);
    return c.json<InitResponse>({
      type: 'init',
      postId,
      username,
      date,
      puzzle,
      streak,
      solvedToday: best !== null,
      bestLaunchesToday: best,
      leaderboard,
      localMode: false,
    });
  } catch (error) {
    console.error('Downstream init failed, falling back to local mode:', error);
    return c.json<InitResponse>({
      type: 'init',
      postId,
      username: 'you',
      date,
      puzzle,
      streak: 0,
      solvedToday: false,
      bestLaunchesToday: null,
      leaderboard: [],
      localMode: true,
    });
  }
});

api.post('/complete', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  let body: CompleteRequest;
  try {
    body = await c.req.json<CompleteRequest>();
  } catch {
    return c.json<ErrorResponse>({ status: 'error', message: 'invalid JSON body' }, 400);
  }
  const date = utcDateKey(new Date());
  try {
    const username = (await reddit.getCurrentUsername()) ?? 'anonymous';
    const lastPlayed = await redis.get(`user:${username}:lastPlayed`);
    const storedStreak = toInt(await redis.get(`user:${username}:streak`)) ?? 0;
    let streak = storedStreak;
    let bestLaunchesToday: number | null = toInt(
      await redis.get(`user:${username}:best:${date}`)
    );
    if (body.won) {
      // Streak: +1 if yesterday was played, 1 if this is a fresh streak,
      // unchanged if today was already solved (replay in practice mode).
      if (lastPlayed === date) {
        streak = storedStreak;
      } else if (lastPlayed === addDays(date, -1)) {
        streak = storedStreak + 1;
      } else {
        streak = 1;
      }
      if (bestLaunchesToday === null || body.launchesUsed < bestLaunchesToday) {
        bestLaunchesToday = body.launchesUsed;
        await redis.set(`user:${username}:best:${date}`, String(bestLaunchesToday));
      }
      // Leaderboard: keep the best (lowest) score for this user today.
      const score = lbScore(body.launchesUsed, body.timeMs);
      const existing = await redis.zScore(`lb:${postId}:${date}`, username);
      if (existing === undefined || score < existing) {
        await redis.zAdd(`lb:${postId}:${date}`, { score, member: username });
      }
      await redis.set(`user:${username}:lastPlayed`, date);
      await redis.set(`user:${username}:streak`, String(streak));
    } else {
      // Out of launches: the streak is broken.
      streak = 0;
      await redis.set(`user:${username}:lastPlayed`, date);
      await redis.set(`user:${username}:streak`, '0');
    }
    const leaderboard = await leaderboardFor(postId, date);
    return c.json<CompleteResponse>({
      type: 'complete',
      streak,
      solvedToday: body.won || bestLaunchesToday !== null,
      bestLaunchesToday,
      leaderboard,
    });
  } catch (error) {
    console.error('Downstream complete failed:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'failed to record result' }, 500);
  }
});

api.get('/leaderboard', async (c) => {
  const { postId } = context;
  if (!postId) {
    return c.json<ErrorResponse>({ status: 'error', message: 'postId is required' }, 400);
  }
  const date = utcDateKey(new Date());
  try {
    const leaderboard = await leaderboardFor(postId, date);
    return c.json<LeaderboardResponse>({ type: 'leaderboard', date, leaderboard });
  } catch (error) {
    console.error('Downstream leaderboard failed:', error);
    return c.json<ErrorResponse>({ status: 'error', message: 'failed to load leaderboard' }, 500);
  }
});
