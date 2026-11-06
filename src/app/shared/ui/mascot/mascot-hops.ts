import type { TerminalStatus } from '../../../../shared/notification/notification.model';
import { makeTimers, type Interval, type MascotClock } from './mascot-clock';

/** A small hop with a squash on landing, or the quick double hop that greets Waiting. */
export type Hop = 'hop' | 'double';

/** How long each hop lasts, in ms; matches the animations in mascot.css. */
export const HOP_FOR: Readonly<Record<Hop, number>> = { hop: 560, double: 900 };

/** How a status hops: the hop that greets it when the Mascot turns to it, and the time between hops after that. */
export interface StatusHops {
  readonly entry: Hop | null;
  readonly every: Interval | null;
}

/** Normal is a hop every 20-40 s, Working hops more often, Idle never; Waiting pulses instead (mascot.css). */
export const STATUS_HOPS: Readonly<Record<TerminalStatus, StatusHops>> = {
  Working: { entry: null, every: { min: 10_000, max: 15_000 } },
  Done: { entry: 'hop', every: { min: 20_000, max: 40_000 } },
  Error: { entry: 'hop', every: { min: 20_000, max: 40_000 } },
  Waiting: { entry: 'double', every: null },
  Idle: { entry: null, every: null },
};

export interface Hops {
  /** Cancels every timer and lands the Mascot. */
  readonly stop: () => void;
}

/**
 * The hops of one status: its entry hop at once when the Mascot has just turned to it, then a hop at random intervals as
 * STATUS_HOPS says. Each plays once and lands. Nothing runs after `stop`.
 */
export const startHops = (clock: MascotClock, status: TerminalStatus, entered: boolean, play: (hop: Hop | null) => void): Hops => {
  const timers = makeTimers(clock);
  const hop = (kind: Hop): void => {
    play(kind);
    timers.wait(HOP_FOR[kind], () => play(null));
  };

  const { entry, every } = STATUS_HOPS[status];
  if (entered && entry !== null) hop(entry);
  if (every !== null) timers.repeat(every, () => hop('hop'));

  return {
    stop: () => {
      timers.stop();
      play(null);
    },
  };
};
