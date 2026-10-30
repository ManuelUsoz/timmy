import { Context, Effect, Layer, Ref } from 'effect';
import { planFor, startupMode, type Rect, type WindowMode, type WindowPlan } from '../../src/shared/window/window.model';

/** The window and screen, the only part of this service that touches Electron. */
export interface WindowHostShape {
  /** Work area of the display the window is on (the primary display before the window exists). */
  readonly workArea: Effect.Effect<Rect>;
  readonly apply: (plan: WindowPlan) => Effect.Effect<void>;
}

export class WindowHost extends Context.Service<WindowHost, WindowHostShape>()('timmy/WindowHost') {}

export interface WindowServiceShape {
  readonly current: Effect.Effect<WindowMode>;
  readonly request: (mode: WindowMode) => Effect.Effect<WindowMode>;
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
      request: Effect.fn('WindowService.request')(function* (target: WindowMode) {
        if ((yield* Ref.get(mode)) === target) return target;
        const workArea = yield* host.workArea;
        yield* host.apply(planFor(target, workArea));
        yield* Ref.set(mode, target);
        return target;
      }),
    };
  }),
);
