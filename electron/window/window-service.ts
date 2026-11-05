import { Context, Effect, Layer, Stream, SubscriptionRef } from 'effect';
import { planFor, startupMode, type Rect, type WindowPoint, type WindowMode, type WindowPlan } from '../../src/shared/window/window.model';

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
  /** Whether the window is shown and not minimized: the value now, then every change. */
  readonly visible: Stream.Stream<boolean>;
  /** Where the cursor is, in the window's own coordinates. The host polls only while the stream is being read, so ending the stream stops the polling. */
  readonly cursor: Stream.Stream<WindowPoint>;
}

export class WindowHost extends Context.Service<WindowHost, WindowHostShape>()('timmy/WindowHost') {}

export interface WindowServiceShape {
  readonly current: Effect.Effect<WindowMode>;
  /** The current mode, then every change. */
  readonly modes: Stream.Stream<WindowMode>;
  readonly request: (mode: WindowMode) => Effect.Effect<WindowMode>;
  readonly close: Effect.Effect<void>;
  readonly minimize: Effect.Effect<void>;
  readonly toggleMaximize: Effect.Effect<void>;
  readonly maximized: Stream.Stream<boolean>;
  /** The cursor, while the Mascot can be seen: the window is shown, not minimized, and in the Pill or Panel. Silent otherwise, and resumes by itself. */
  readonly cursor: Stream.Stream<WindowPoint>;
}

/** Owns the current Window mode and drives the host to it. */
export class WindowService extends Context.Service<WindowService, WindowServiceShape>()('timmy/WindowService') {}

export const layerWindowService: Layer.Layer<WindowService, never, WindowHost> = Layer.effect(
  WindowService,
  Effect.gen(function* () {
    const host = yield* WindowHost;
    const mode = yield* SubscriptionRef.make<WindowMode>(startupMode);

    // The cursor only matters while the Mascot is on screen. Either input can change it, so fold both into one answer.
    type Showing = { readonly mode: WindowMode; readonly visible: boolean };
    const following = Stream.merge(
      host.visible.pipe(Stream.map((visible) => (showing: Showing): Showing => ({ ...showing, visible }))),
      SubscriptionRef.changes(mode).pipe(Stream.map((next) => (showing: Showing): Showing => ({ ...showing, mode: next }))),
    ).pipe(
      Stream.scan((): Showing => ({ mode: startupMode, visible: false }), (showing, update) => update(showing)),
      Stream.map(({ mode: current, visible }) => visible && current !== 'Expanded'),
      Stream.changes,
    );
    const cursor = following.pipe(Stream.switchMap((on) => (on ? host.cursor : Stream.empty)));

    return {
      current: SubscriptionRef.get(mode),
      modes: SubscriptionRef.changes(mode),
      cursor,
      close: host.close,
      minimize: host.minimize,
      toggleMaximize: host.toggleMaximize,
      maximized: host.maximized,
      request: Effect.fn('WindowService.request')(function* (target: WindowMode) {
        if ((yield* SubscriptionRef.get(mode)) === target) return target;
        const workArea = yield* host.workArea;
        if (!(yield* host.apply(planFor(target, workArea)))) return yield* SubscriptionRef.get(mode);
        yield* SubscriptionRef.set(mode, target);
        return target;
      }),
    };
  }),
);
