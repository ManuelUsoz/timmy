import { makeTimers, type MascotClock } from './mascot-clock';

/** A stroke of the rally: the racket on the viewer's right (forehand) or on the viewer's left (backhand). */
export type Stroke = 'forehand' | 'backhand';

/** Time from the end of one rally to the start of the next, in ms. */
export const RALLY_EVERY = { min: 30_000, max: 60_000 } as const;
/** How long each stroke lasts: the ball comes in, is hit, and leaves the frame. The component hands it to mascot.css. */
export const STROKE_FOR = 1200;

export interface Rally {
  /** Plays a rally now, unless one is already playing; the wait for the next one starts over when it ends. */
  readonly play: () => void;
  /** Cancels every timer and takes the racket and the ball away. */
  readonly stop: () => void;
}

/**
 * The Mascot's tennis while Idle: 30-60 s after it starts or after the last rally, a rally of 2-3 strokes against an
 * unseen opponent, alternating forehand and backhand. `show` gets each stroke as it starts, and null once the rally is
 * over. Nothing runs after `stop`.
 */
export const startRally = (clock: MascotClock, show: (stroke: Stroke | null) => void): Rally => {
  const timers = makeTimers(clock);
  let playing = false;
  let cancelNext = (): void => {};

  const scheduleNext = (): void => {
    cancelNext = timers.wait(timers.between(RALLY_EVERY), play);
  };

  const play = (): void => {
    if (playing) return;
    cancelNext();
    playing = true;
    const strokes = clock.random() < 0.5 ? 2 : 3;
    const first: Stroke = clock.random() < 0.5 ? 'forehand' : 'backhand';
    const second: Stroke = first === 'forehand' ? 'backhand' : 'forehand';
    const hit = (n: number): void => {
      if (n === strokes) {
        playing = false;
        show(null);
        scheduleNext();
        return;
      }
      show(n % 2 === 0 ? first : second);
      timers.wait(STROKE_FOR, () => hit(n + 1));
    };
    hit(0);
  };

  scheduleNext();

  return {
    play,
    stop: () => {
      timers.stop();
      playing = false;
      show(null);
    },
  };
};
