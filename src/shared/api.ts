import type { Puzzle } from './puzzle';

export type LeaderboardEntry = {
  username: string;
  launches: number;
  timeMs: number;
};

export type InitResponse = {
  type: 'init';
  postId: string;
  username: string;
  date: string;
  puzzle: Puzzle;
  streak: number;
  solvedToday: boolean;
  bestLaunchesToday: number | null;
  leaderboard: LeaderboardEntry[];
  /** True when the server could not reach Reddit/Redis and the client should use local play. */
  localMode: boolean;
};

export type CompleteRequest = {
  won: boolean;
  launchesUsed: number;
  timeMs: number;
};

export type CompleteResponse = {
  type: 'complete';
  streak: number;
  solvedToday: boolean;
  bestLaunchesToday: number | null;
  leaderboard: LeaderboardEntry[];
};

export type LeaderboardResponse = {
  type: 'leaderboard';
  date: string;
  leaderboard: LeaderboardEntry[];
};

export type ErrorResponse = {
  status: 'error';
  message: string;
};
