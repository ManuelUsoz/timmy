import type { WindowPoint } from '../../../../shared/window/window.model';

/** The farthest the eyes move from straight ahead, in units of the 128-unit Mascot: far enough to read, short enough to stay inside the body. */
export const MAX_GAZE_SHIFT = 4;

/** Distance in pixels from the Mascot at which the eyes have shifted all the way; a closer cursor shifts them proportionally. */
const FULL_GAZE_DISTANCE = 200;

/** Rounded so a one-pixel move of a far cursor does not restyle the Mascot. */
const tenth = (value: number): number => Math.round(value * 10) / 10 + 0;

/**
 * Where the eyes move to look at `cursor`, from the Mascot's `center`; both are in the window's coordinates.
 * The shift points at the cursor and grows with distance up to `MAX_GAZE_SHIFT`, so it is never larger than that in any
 * direction. With no cursor position the eyes look straight ahead.
 */
export const gazeOffset = (cursor: WindowPoint | null, center: WindowPoint): WindowPoint => {
  if (cursor === null) return { x: 0, y: 0 };
  const dx = cursor.x - center.x;
  const dy = cursor.y - center.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { x: 0, y: 0 };
  const shift = MAX_GAZE_SHIFT * Math.min(1, distance / FULL_GAZE_DISTANCE);
  return { x: tenth((dx / distance) * shift), y: tenth((dy / distance) * shift) };
};
