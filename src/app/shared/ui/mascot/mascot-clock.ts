import { InjectionToken } from '@angular/core';

/** The time and chance behind the Mascot's idle life. Tests replace it so no spec has to wait for a blink. */
export interface MascotClock {
  /** A number in [0, 1), as `Math.random`. */
  readonly random: () => number;
  /** Runs `run` once after `ms`; the returned function cancels it. */
  readonly after: (ms: number, run: () => void) => () => void;
}

export const MASCOT_CLOCK = new InjectionToken<MascotClock>('MascotClock', {
  providedIn: 'root',
  factory: () => ({
    random: () => Math.random(),
    after: (ms, run) => {
      const id = setTimeout(run, ms);
      return () => clearTimeout(id);
    },
  }),
});
