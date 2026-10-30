import type { Rect } from './window.model';

export const TRANSITION_MS = 200;

export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

/** Progress is a function of elapsed time, never of step count: timers on Windows are coarse and uneven. */
export const progressAt = (elapsedMs: number, durationMs: number = TRANSITION_MS): number =>
  durationMs <= 0 ? 1 : Math.min(1, Math.max(0, elapsedMs / durationMs));

const lerp = (from: number, to: number, t: number): number => Math.round(from + (to - from) * t);

/** The bounds `elapsedMs` into a transition. At and after the duration this is exactly `to`. */
export const boundsAt = (from: Rect, to: Rect, elapsedMs: number, durationMs: number = TRANSITION_MS): Rect => {
  const progress = progressAt(elapsedMs, durationMs);
  if (progress >= 1) return to;
  const t = easeOutCubic(progress);
  return {
    x: lerp(from.x, to.x, t),
    y: lerp(from.y, to.y, t),
    width: lerp(from.width, to.width, t),
    height: lerp(from.height, to.height, t),
  };
};
