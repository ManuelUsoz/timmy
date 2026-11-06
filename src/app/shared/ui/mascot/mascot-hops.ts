import type { TerminalStatus } from '../../../../shared/notification/notification.model';
import { makeTimers, type Interval, type MascotClock } from './mascot-clock';

/** A small hop with a squash on landing, or the quick double hop that greets Waiting. */
export type Hop = 'hop' | 'double';

/** How long each hop lasts, in ms; matches the animations in mascot.css. */
export const HOP_FOR: Record<Hop, number> = { hop: 560, double: 900 };

/** Time between hops per status, in ms; none while Idle, and Waiting pulses instead. */
export const HOP_EVERY: Record<TerminalStatus, Interval | null> = {
  Working: { min: 10_000, max: 15_000 },
  Done: { min: 20_000, max: 40_000 },
  Error: { min: 20_000, max: 40_000 },
  Waiting: null,
  Idle: null,
};

/** The hop that greets a status when the Mascot turns to it. */
export const ENTRY_HOP: Record<TerminalStatus, Hop | null> = {
  Waiting: 'double',
  Done: 'hop',
  Error: 'hop',
  Working: null,
  Idle: null,
};

export interface Hops {
  /** Cancels every timer and lands the Mascot. */
  readonly stop: () => void;
}

/**
 * The hops of one status: the entry hop at once when the Mascot has just turned to it, then a hop at random intervals as
 * HOP_EVERY says. Each plays once and lands. Nothing runs after `stop`.
 */
export const startHops = (clock: MascotClock, status: TerminalStatus, entered: boolean, play: (hop: Hop | null) => void): Hops => {
  const timers = makeTimers(clock);
  const hop = (kind: Hop): void => {
    play(kind);
    timers.wait(HOP_FOR[kind], () => play(null));
  };

  const entry = ENTRY_HOP[status];
  if (entered && entry !== null) hop(entry);
  const every = HOP_EVERY[status];
  if (every !== null) timers.repeat(every, () => hop('hop'));

  return {
    stop: () => {
      timers.stop();
      play(null);
    },
  };
};
