import { gazeOffset } from './gaze';

const center = { x: 1000, y: 500 };

describe('gazeOffset', () => {
  it('looks straight ahead with no cursor position', () => {
    expect(gazeOffset(null, center)).toEqual({ x: 0, y: 0 });
  });

  it('looks straight ahead when the cursor is on the Mascot itself', () => {
    expect(gazeOffset(center, center)).toEqual({ x: 0, y: 0 });
  });

  it('shifts toward the cursor in proportion to how far it is, up to the limit', () => {
    expect(gazeOffset({ x: 1100, y: 500 }, center)).toEqual({ x: 2, y: 0 });
    expect(gazeOffset({ x: 1000, y: 400 }, center)).toEqual({ x: 0, y: -2 });
  });

  it('never pushes the eyes more than 4 of 128 off center, however far the cursor is', () => {
    expect(gazeOffset({ x: 5000, y: 500 }, center)).toEqual({ x: 4, y: 0 });
    expect(gazeOffset({ x: -9000, y: 500 }, center)).toEqual({ x: -4, y: 0 });
    expect(gazeOffset({ x: 1000, y: 90_000 }, center)).toEqual({ x: 0, y: 4 });
    const diagonal = gazeOffset({ x: 9000, y: 8500 }, center);
    expect(diagonal.x).toBeGreaterThan(0);
    expect(diagonal.y).toBeGreaterThan(0);
    expect(Math.hypot(diagonal.x, diagonal.y)).toBeLessThanOrEqual(4);
  });

  it('follows a cursor on another display, whose coordinates are negative or beyond the first display', () => {
    expect(gazeOffset({ x: -2500, y: 500 }, center).x).toBe(-4);
    expect(gazeOffset({ x: 4000, y: 500 }, center).x).toBe(4);
  });
});
