import { boundsAt, progressAt, TRANSITION_MS } from '../../src/shared/window/bounds-animation';
import type { Rect } from '../../src/shared/window/window.model';

/** Timer and clock, injectable so the animation can be driven by hand in tests. */
export interface AnimatorClock {
  readonly now: () => number;
  /** Runs `tick` after `ms`; returns a cancel function. */
  readonly schedule: (tick: () => void, ms: number) => () => void;
}

export const systemClock: AnimatorClock = {
  now: () => performance.now(),
  schedule: (tick, ms) => {
    const handle = setTimeout(tick, ms);
    return () => clearTimeout(handle);
  },
};

/** On Windows a 16 ms timer gives ~7 steps per 200 ms; ~8 ms gives 22-32 (NXY-49). */
const STEP_MS = 8;

export interface BoundsAnimator {
  /** Animates from `from` to `to`, cancelling any running animation. The last write is always exactly `to`. */
  readonly animate: (from: Rect, to: Rect, setBounds: (bounds: Rect) => void, onDone?: () => void) => void;
  /** Stops a running animation where it is. */
  readonly cancel: () => void;
}

export const makeBoundsAnimator = (clock: AnimatorClock = systemClock, durationMs = TRANSITION_MS): BoundsAnimator => {
  let cancelTick: (() => void) | undefined;
  const cancel = () => {
    cancelTick?.();
    cancelTick = undefined;
  };
  return {
    cancel,
    animate: (from, to, setBounds, onDone) => {
      cancel();
      const start = clock.now();
      const step = () => {
        const elapsed = clock.now() - start;
        // `boundsAt` returns the exact target at the end: DPI rounding leaves interpolated bounds 1-2 px off at 125%.
        setBounds(boundsAt(from, to, elapsed, durationMs));
        if (progressAt(elapsed, durationMs) >= 1) {
          cancelTick = undefined;
          onDone?.();
        } else {
          cancelTick = clock.schedule(step, STEP_MS);
        }
      };
      step();
    },
  };
};
