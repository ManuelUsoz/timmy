import type { MascotClock } from './mascot-clock';

/** Which way the eyes flick: left, back to the cursor, or right. */
export type GlanceSide = -1 | 0 | 1;

/** What the idle life changes on the Mascot. */
export interface LifeSink {
  readonly blink: (blinking: boolean) => void;
  readonly glance: (side: GlanceSide) => void;
}

export interface Life {
  /** The cursor moved: the stillness a glance waits for starts over, and the eyes go back to following it. */
  readonly cursorMoved: () => void;
  /** Cancels every timer and puts the Mascot at rest. */
  readonly stop: () => void;
}

/** Time between blinks, in ms. */
export const BLINK_EVERY = { min: 4000, max: 7000 } as const;
/** How long a blink lasts; matches the animation in mascot.css. */
export const BLINK_FOR = 160;
/** How long the cursor has to be still before the eyes glance, and then how long before the next glance, in ms. */
export const STILL_FOR = { min: 5000, max: 9000 } as const;
/** How long the eyes stay to the side in a glance. */
export const GLANCE_FOR = 700;

/**
 * The Mascot's idle life: a blink every 4-7 s, and a glance to a random side once the cursor has been still for a while.
 * Each plays once and returns to rest. Nothing runs until this is called, and nothing runs after `stop`.
 */
export const startLife = (clock: MascotClock, sink: LifeSink): Life => {
  const timers = new Set<() => void>();
  const wait = (ms: number, run: () => void): (() => void) => {
    const cancel = clock.after(ms, () => {
      timers.delete(cancel);
      run();
    });
    timers.add(cancel);
    return cancel;
  };
  const cancel = (timer: () => void) => {
    timer();
    timers.delete(timer);
  };
  const between = ({ min, max }: { readonly min: number; readonly max: number }) => min + clock.random() * (max - min);

  const scheduleBlink = (): void => {
    wait(between(BLINK_EVERY), () => {
      scheduleBlink();
      sink.blink(true);
      wait(BLINK_FOR, () => sink.blink(false));
    });
  };

  let stillTimer: (() => void) | null = null;
  const scheduleGlance = (): void => {
    stillTimer = wait(between(STILL_FOR), () => {
      scheduleGlance();
      sink.glance(clock.random() < 0.5 ? -1 : 1);
      wait(GLANCE_FOR, () => sink.glance(0));
    });
  };

  scheduleBlink();
  scheduleGlance();

  return {
    cursorMoved: () => {
      if (stillTimer) cancel(stillTimer);
      sink.glance(0);
      scheduleGlance();
    },
    stop: () => {
      timers.forEach((timer) => timer());
      timers.clear();
      sink.blink(false);
      sink.glance(0);
    },
  };
};
