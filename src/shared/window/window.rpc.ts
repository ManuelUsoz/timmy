import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { WindowPoint, WindowMode } from './window.model';

/**
 * Main owns the window: the renderer asks for a mode and reads the current one,
 * and never sets bounds or flags itself. See ADR 0004.
 */
export const WindowRpcs = RpcGroup.make(
  Rpc.make('Window.current', { success: WindowMode }),

  /** Moves the window to `mode`; answers with the mode it is in afterwards. */
  Rpc.make('Window.request', {
    payload: { mode: WindowMode },
    success: WindowMode,
  }),

  /** Quits the app. The window is frameless in every mode (ADR 0005), so the renderer draws its own controls. */
  Rpc.make('Window.close'),

  /** Minimizes the window to the taskbar. */
  Rpc.make('Window.minimize'),

  /** Maximizes the window, or restores it when it is maximized. Only Expanded is maximizable. */
  Rpc.make('Window.toggleMaximize'),

  /** Pushes whether the window is maximized: the current value first, then every change. */
  Rpc.make('Window.maximized', { success: Schema.Boolean, stream: true }),

  /**
   * Pushes where the cursor is, in the window's own coordinates (about 30 Hz, only when it or the window moves), so the Mascot
   * can look at it wherever it is on screen, over any display.
   * Main only runs it while the Pill or Panel is visible: it is silent while the window is hidden, minimized or Expanded, and resumes by itself.
   */
  Rpc.make('Window.cursor', { success: WindowPoint, stream: true }),
);
