import { Context, Effect, Layer, Ref, Stream } from 'effect';
import { planFor, startupMode, type Rect, type WindowMode, type WindowPlan } from '../../src/shared/window/window.model';

/** The window and screen, the only part of this service that touches Electron. */
export interface WindowHostShape {
  /** Work area of the display the window is on (the primary display before the window exists). */
  readonly workArea: Effect.Effect<Rect>;
  /** Resolves false when there is no window to apply the plan to. */
  readonly apply: (plan: WindowPlan) => Effect.Effect<boolean>;
  /** Quits the app. */
  readonly close: Effect.Effect<void>;
  /** Minimizes the window to the taskbar. */
  readonly minimize: Effect.Effect<void>;
  /** Maximizes the window, or restores it when it is maximized. */
  readonly toggleMaximize: Effect.Effect<void>;
  /** The maximized state now, then every change. The window has no system controls to read it from. */
  readonly maximized: Stream.Stream<boolean>;
}

export class WindowHost extends Context.Service<WindowHost, WindowHostShape>()('timmy/WindowHost') {}

export interface WindowServiceShape {
  readonly current: Effect.Effect<WindowMode>;
  readonly request: (mode: WindowMode) => Effect.Effect<WindowMode>;
  readonly close: Effect.Effect<void>;
  readonly minimize: Effect.Effect<void>;
  readonly toggleMaximize: Effect.Effect<void>;
  readonly maximized: Stream.Stream<boolean>;
}

/** Owns the current Window mode and drives the host to it. */
export class WindowService extends Context.Service<WindowService, WindowServiceShape>()('timmy/WindowService') {}

export const layerWindowService: Layer.Layer<WindowService, never, WindowHost> = Layer.effect(
  WindowService,
  Effect.gen(function* () {
    const host = yield* WindowHost;
    const mode = yield* Ref.make<WindowMode>(startupMode);
    return {
      current: Ref.get(mode),
      close: host.close,
      minimize: host.minimize,
      toggleMaximize: host.toggleMaximize,
      maximized: host.maximized,
      request: Effect.fn('WindowService.request')(function* (target: WindowMode) {
        if ((yield* Ref.get(mode)) === target) return target;
        const workArea = yield* host.workArea;
        if (!(yield* host.apply(planFor(target, workArea)))) return yield* Ref.get(mode);
        yield* Ref.set(mode, target);
        return target;
      }),
    };
  }),
);
