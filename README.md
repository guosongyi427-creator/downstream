# Downstream — a daily river puzzle

**Downstream** is a bite-sized daily puzzle game for Reddit, built on the
[Devvit Web](https://developers.reddit.com/) platform. A new river every day:
bend the current with stones, launch the paper boat, and guide it to the dock —
in 3 launches or fewer.

> **A new river every day.** Every player gets the same puzzle on the same day,
> so the daily leaderboard is a fair race. Come back tomorrow for a fresh river.

---

## How to play

1. **Look at the river.** The paper boat starts at the top and drifts
   downstream with the current. A dotted line previews the first part of its
   journey — the rest is up to the river.
2. **Place stones.** Drag a stone from the tray onto the river (up to 3).
   Each stone bends the current sideways around it, steering the boat.
   Tap a placed stone to take it back.
3. **Launch the boat.** Watch it sail. If it hits a rock or drifts off the
   river, the stones stay where they are — adjust and try again.
4. **Reach the dock.** Solve it in as few launches as you can. Your best
   result goes on the day's leaderboard, and solving every day builds your
   streak.

**Rules of the river:**

- You get **3 launches** per day. A launch that misses the dock does not
  cost you your stones — only a launch.
- The boat is carried by the current and by your stones. Stones never push
  the boat upstream; they only bend the flow sideways.
- The dotted preview shows only the first 55% of the journey, so finding a
  winning placement is a real puzzle: plan, launch, observe, adjust.

---

## Why it is fun every day

- **One shared puzzle a day.** The river (rocks, dock position, current
  meander) is generated deterministically from the date, so everyone plays
  the same river and the leaderboard means something.
- **Every river is fair.** The generator guarantees two things for every
  single day: the boat **cannot** reach the dock with no stones, and it
  **can** reach the dock with 3 stones or fewer. Verified by automated
  tests for every day from Dec 1, 2026 through Jan 31, 2027.
- **Streaks and leaderboards.** Solve daily to grow your streak, and see
  who solved today's river in the fewest launches.
- **Share your result.** A one-tap share copies a compact result
  (e.g. `Downstream 2026-11-24 ⛵ 1/3 🔥 5`) to post in the comments.

---

## Tech

- **Devvit Web** (React 19 + Tailwind 4 + Hono + Redis) — the game runs as an
  Interactive Post on Reddit. The inline splash is a light "tap to play"
  card; the full game opens in expanded mode.
- **Canvas 2D rendering** — hand-drawn river, rocks, dock, and origami boat;
  no heavy 3D engine, so it loads fast inside the Reddit iframe.
- **Deterministic puzzle generator** (`src/shared/puzzle.ts`) — a seeded
  PRNG (mulberry32) plus a flow simulation and a random-search solver.
  The same date always yields the same river.
- **Redis-backed streaks and leaderboards** (`src/server/routes/api.ts`) —
  per-user streaks, best launches per day, and a sorted-set leaderboard per
  post per day. If the server is unreachable, the game falls back to a
  local mode that plays fully offline with streaks saved in `localStorage`.

---

## Project layout

```
downstream/
  devvit.json            # app config: post entrypoints, menu, server
  package.json
  src/
    shared/
      puzzle.ts          # river generation, flow simulation, solver
      api.ts             # request/response types
    client/
      splash.tsx         # inline "tap to play" card
      game.tsx           # the game (placing → sailing → win/loss)
      game/engine.ts     # canvas rendering + pointer helpers
    server/
      index.ts           # Hono app
      routes/api.ts      # /api/init, /api/complete, /api/leaderboard
      routes/menu.ts     # "Create a new Downstream post"
      core/post.ts       # post title
```

## Development

```bash
npm install
npm run dev          # playtest in a test subreddit (needs devvit login)
npm run build        # vite build (client + server)
npm run test:types   # tsc --build
npm run test:unit    # node --test on src/shared/puzzle.test.ts
npm run lint         # eslint
```

`src/shared/puzzle.test.ts` verifies that every daily puzzle from
Dec 1, 2026 through Jan 31, 2027 is solvable with ≤ 3 stones and
unsolvable with 0 stones, and that generation is deterministic.

## The daily puzzle, explained

The river is 360 × 560 units. The current flows downward with a sinusoidal
meander, and each stone adds a sideways push within its radius. The boat is
simulated step by step (max 900 steps). A launch wins when the boat enters
the dock's target circle, and fails on a rock hit, leaving the river, or
running out of steps. The generator tries up to 40 derived seeds per day
until it finds a river that is both non-trivial (no-stone launch fails) and
solvable (a random-search solver finds a placement within 3 stones).

---

**Downstream — a daily river puzzle · a new river every day · r/DownstreamGame**
