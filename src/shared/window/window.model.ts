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
  /** Whether the window can be maximized (by our own control, ADR 0005). Only Expanded; maximized is a state of Expanded, not a mode. */
  readonly maximizable: boolean;
  /** Narrowest the user may resize to. 0 means no minimum. */
  readonly minWidth: number;
}

/** What the window reports about itself; `normalBounds` are the bounds it has when not maximized. */
export interface WindowGeometry {
  readonly bounds: Rect;
  readonly normalBounds: Rect;
  readonly maximized: boolean;
}

/** Where a transition out of the current mode starts: the restored bounds, even while maximized. */
export const restoredBounds = (geometry: WindowGeometry): Rect =>
  geometry.maximized ? geometry.normalBounds : geometry.bounds;

const MARGIN = 16;
const PILL_SIZE = { width: 440, height: 40 } as const;
const PANEL_SIZE = { width: 440, height: 560 } as const;

const EXPANDED_SIZE = { width: 1280, height: 800 } as const;
const EXPANDED_MIN_WIDTH = 800;
const EXPANDED_WORK_AREA_SHARE = 0.9;

/** The ideal size, capped at 90 % of the work area but never under the minimum, and never over the work area itself. */
const expandedExtent = (ideal: number, available: number, floor: number): number =>
  Math.min(available, Math.max(floor, Math.min(ideal, Math.floor(available * EXPANDED_WORK_AREA_SHARE))));

const cornerSize = (mode: 'Pill' | 'Panel') => (mode === 'Pill' ? PILL_SIZE : PANEL_SIZE);

/**
 * Pill and Panel hug the bottom-right corner of the work area, so a switch keeps the corner fixed.
 * Expanded is a resizable, maximizable window centered in the work area (ADR 0005); size and position are not remembered.
 */
export const planFor = (mode: WindowMode, workArea: Rect): WindowPlan => {
  if (mode === 'Expanded') {
    const width = expandedExtent(EXPANDED_SIZE.width, workArea.width, EXPANDED_MIN_WIDTH);
    const height = expandedExtent(EXPANDED_SIZE.height, workArea.height, 0);
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
      resizable: true,
      maximizable: true,
      minWidth: EXPANDED_MIN_WIDTH,
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
    maximizable: false,
    minWidth: 0,
  };
};
