import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { WindowMode } from './window.model';

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

  /** Quits the app. The frameless window has no title bar, so the renderer offers this itself. */
  Rpc.make('Window.close'),
);
