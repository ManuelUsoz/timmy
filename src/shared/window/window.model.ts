import { Schema } from 'effect';

/** How much of Timmy is showing. Timmy always starts in `Pill`. */
export const WindowMode = Schema.Literals(['Pill', 'Panel', 'Expanded']).annotate({ identifier: 'WindowMode' });
export type WindowMode = typeof WindowMode.Type;

export const startupMode: WindowMode = 'Pill';

/** The modes the user can move to from `current`: every mode but the current one. */
export const offeredModes = (current: WindowMode): ReadonlyArray<WindowMode> =>
  WindowMode.literals.filter((mode) => mode !== current);

export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** What the window must look like in a mode. Main applies it; the renderer never sets bounds or flags. */
export interface WindowPlan {
  readonly mode: WindowMode;
  readonly bounds: Rect;
  readonly alwaysOnTop: boolean;
  readonly skipTaskbar: boolean;
  readonly resizable: boolean;
}

const MARGIN = 16;
const PILL_SIZE = { width: 440, height: 40 } as const;
const PANEL_SIZE = { width: 440, height: 560 } as const;

const EXPANDED_SIZE = { width: 900, height: 700 } as const;

const cornerSize = (mode: 'Pill' | 'Panel') => (mode === 'Pill' ? PILL_SIZE : PANEL_SIZE);

/**
 * Pill and Panel hug the bottom-right corner of the work area, so a switch keeps the corner fixed.
 * Expanded is a normal window centered in the work area (never larger than it); size and position are not remembered.
 */
export const planFor = (mode: WindowMode, workArea: Rect): WindowPlan => {
  if (mode === 'Expanded') {
    const width = Math.min(EXPANDED_SIZE.width, workArea.width);
    const height = Math.min(EXPANDED_SIZE.height, workArea.height);
    return {
      mode,
      bounds: {
        width,
        height,
        x: workArea.x + Math.round((workArea.width - width) / 2),
        y: workArea.y + Math.round((workArea.height - height) / 2),
      },
      alwaysOnTop: false,
      skipTaskbar: false,
      resizable: false,
    };
  }
  const size = cornerSize(mode);
  return {
    mode,
    bounds: {
      ...size,
      x: workArea.x + workArea.width - size.width - MARGIN,
      y: workArea.y + workArea.height - size.height - MARGIN,
    },
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
  };
};
