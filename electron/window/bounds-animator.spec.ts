import { describe, expect, it } from 'vitest';
import type { Rect } from '../../src/shared/window/window.model';
import { makeBoundsAnimator, type AnimatorClock } from './bounds-animator';

const from: Rect = { x: 0, y: 0, width: 100, height: 40 };
const to: Rect = { x: 50, y: 50, width: 300, height: 200 };

/** Manual clock: `advance` moves time and runs the scheduled tick once. */
const makeClock = () => {
  let time = 0;
  let pending: (() => void) | undefined;
  const clock: AnimatorClock = {
    now: () => time,
    schedule: (tick) => {
      pending = tick;
      return () => {
        if (pending === tick) pending = undefined;
      };
    },
  };
  return {
    clock,
    advance: (ms: number) => {
      time += ms;
      const tick = pending;
      pending = undefined;
      tick?.();
    },
    isIdle: () => pending === undefined,
  };
};

describe('BoundsAnimator', () => {
  it('writes the start immediately and ends exactly on the target', () => {
    const { clock, advance, isIdle } = makeClock();
    const writes: Rect[] = [];
    makeBoundsAnimator(clock, 200).animate(from, to, (b) => writes.push(b));
    expect(writes[0]).toEqual(from);
    advance(100);
    expect(writes[1]).not.toEqual(to);
    advance(150);
    expect(writes.at(-1)).toEqual(to);
    expect(isIdle()).toBe(true);
  });

  it('follows elapsed time, not the number of ticks', () => {
    const { clock, advance } = makeClock();
    const writes: Rect[] = [];
    makeBoundsAnimator(clock, 200).animate(from, to, (b) => writes.push(b));
    advance(1000);
    expect(writes).toHaveLength(2);
    expect(writes[1]).toEqual(to);
  });

  it('a new animation cancels the running one so the window ends at the latest target', () => {
    const { clock, advance } = makeClock();
    const writes: Rect[] = [];
    const animator = makeBoundsAnimator(clock, 200);
    const other: Rect = { x: 9, y: 9, width: 440, height: 560 };
    animator.animate(from, to, (b) => writes.push(b));
    advance(50);
    animator.animate(writes.at(-1)!, other, (b) => writes.push(b));
    advance(500);
    expect(writes.at(-1)).toEqual(other);
    expect(writes).not.toContain(to);
  });

  it('cancel stops further writes', () => {
    const { clock, advance } = makeClock();
    const writes: Rect[] = [];
    const animator = makeBoundsAnimator(clock, 200);
    animator.animate(from, to, (b) => writes.push(b));
    animator.cancel();
    advance(500);
    expect(writes).toHaveLength(1);
  });

  it('reports completion once, and not when cancelled', () => {
    const { clock, advance } = makeClock();
    const animator = makeBoundsAnimator(clock, 200);
    let done = 0;
    animator.animate(from, to, () => undefined, () => done++);
    advance(300);
    expect(done).toBe(1);
    animator.animate(from, to, () => undefined, () => done++);
    animator.animate(to, from, () => undefined);
    advance(300);
    expect(done).toBe(1);
  });
});
