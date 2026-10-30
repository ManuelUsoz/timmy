import { describe, expect, it } from 'vitest';
import { boundsAt, easeOutCubic, progressAt, TRANSITION_MS } from './bounds-animation';

const from = { x: 1464, y: 984, width: 440, height: 40 };
const to = { x: 510, y: 170, width: 900, height: 700 };

describe('bounds animation', () => {
  it('eases out: fast at the start, settling at the end', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
    expect(easeOutCubic(0.9) - easeOutCubic(0.8)).toBeLessThan(easeOutCubic(0.2) - easeOutCubic(0.1));
  });

  it('derives progress from elapsed time and clamps it', () => {
    expect(progressAt(-5)).toBe(0);
    expect(progressAt(TRANSITION_MS / 2)).toBe(0.5);
    expect(progressAt(TRANSITION_MS * 3)).toBe(1);
    expect(progressAt(10, 0)).toBe(1);
  });

  it('starts at the source and ends exactly on the target', () => {
    expect(boundsAt(from, to, 0)).toEqual(from);
    expect(boundsAt(from, to, TRANSITION_MS)).toBe(to);
    expect(boundsAt(from, to, TRANSITION_MS + 50)).toBe(to);
  });

  it('is in between mid-transition, with whole pixels', () => {
    const mid = boundsAt(from, to, 100);
    expect(mid.width).toBeGreaterThan(from.width);
    expect(mid.width).toBeLessThan(to.width);
    expect(Number.isInteger(mid.x) && Number.isInteger(mid.height)).toBe(true);
  });
});
