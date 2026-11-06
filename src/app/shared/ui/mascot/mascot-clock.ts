import { InjectionToken } from '@angular/core';

/** The time and chance behind the Mascot's idle life. Tests replace it so no spec has to wait for a blink. */
export interface MascotClock {
  /** Milliseconds from some fixed start, as `performance.now`. */
  readonly now: () => number;
  /** A number in [0, 1), as `Math.random`. */
  readonly random: () => number;
  /** Runs `run` once after `ms`; the returned function cancels it. */
  readonly after: (ms: number, run: () => void) => () => void;
}

/** A span of time in ms; a wait drawn from it is a whole number of ms from min to max. */
export interface Interval {
  readonly min: number;
  readonly max: number;
}

/** The timers of one stretch of the Mascot's life, so it can stop them all at once. */
export interface Timers {
  /** Runs `run` once after `ms`; the returned function cancels it. */
  readonly wait: (ms: number, run: () => void) => () => void;
  /** Runs `run` after a wait drawn from `every`, then again after a new draw, until stopped. */
  readonly repeat: (every: Interval, run: () => void) => void;
  /** A wait drawn from `interval`. */
  readonly between: (interval: Interval) => number;
  /** Cancels every timer still pending. */
  readonly stop: () => void;
}

export const makeTimers = (clock: MascotClock): Timers => {
  const pending = new Set<() => void>();
  const wait = (ms: number, run: () => void): (() => void) => {
    const cancel = clock.after(ms, () => {
      pending.delete(cancel);
      run();
    });
    pending.add(cancel);
    return cancel;
  };
  // Whole milliseconds: the waits add up exactly, so a timer due "now" is never left a fraction of a millisecond short.
  const between = ({ min, max }: Interval) => Math.round(min + clock.random() * (max - min));
  const repeat = (every: Interval, run: () => void): void => {
    wait(between(every), () => {
      repeat(every, run);
      run();
    });
  };
  return {
    wait,
    repeat,
    between,
    stop: () => {
      pending.forEach((cancel) => cancel());
      pending.clear();
    },
  };
};

export const MASCOT_CLOCK = new InjectionToken<MascotClock>('MascotClock', {
  providedIn: 'root',
  factory: () => ({
    now: () => performance.now(),
    random: () => Math.random(),
    after: (ms, run) => {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    },
  }),
});
