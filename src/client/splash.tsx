import './index.css';

import { requestExpandedMode } from '@devvit/web/client';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { todayKey } from '../shared/puzzle';

// Inline view (the feed). Keep it light: a title, today's date, one hook line,
// and a single tap to open the full game. No heavy assets here.

export const Splash = () => {
  const dateLabel = new Date(`${todayKey()}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-gradient-to-b from-[#0e7490] to-[#1ba098] px-4 text-center">
      <div className="text-5xl">⛵</div>
      <h1 className="text-3xl font-extrabold tracking-tight text-white">Downstream</h1>
      <p className="text-base font-medium text-[#d6f3f0]">{dateLabel}</p>
      <p className="max-w-[300px] text-sm leading-snug text-white/90">
        A new river every day. Bend the current with stones and guide the paper boat to the dock — in 3
        launches or fewer.
      </p>
      <button
        className="mt-1 rounded-full bg-[#f97316] px-6 py-3 text-base font-bold text-white shadow-lg transition-colors hover:bg-[#ea580c]"
        onClick={(e) => requestExpandedMode(e.nativeEvent, 'game')}
      >
        Tap to play
      </button>
      <p className="text-xs text-white/70">Streaks · Daily river · Free to play</p>
    </div>
  );
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Splash />
  </StrictMode>
);
