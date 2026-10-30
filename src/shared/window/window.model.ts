import { Schema } from 'effect';

/** How much of Timmy is showing. Timmy always starts in `Pill`. */
export const WindowMode = Schema.Literals(['Pill', 'Panel']).annotate({ identifier: 'WindowMode' });
export type WindowMode = typeof WindowMode.Type;

export const startupMode: WindowMode = 'Pill';

const allModes: ReadonlyArray<WindowMode> = ['Pill', 'Panel'];

/** The modes the user can move to from `current`: every mode but the current one. */
export const offeredModes = (current: WindowMode): ReadonlyArray<WindowMode> =>
  allModes.filter((mode) => mode !== current);

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

const sizeOf = (mode: WindowMode) => (mode === 'Pill' ? PILL_SIZE : PANEL_SIZE);

/** Pill and Panel hug the bottom-right corner of the work area, so a switch keeps the corner fixed. */
export const planFor = (mode: WindowMode, workArea: Rect): WindowPlan => {
  const size = sizeOf(mode);
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
