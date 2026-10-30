import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Ref, Stream } from 'effect';
import type { WindowPlan } from '../../src/shared/window/window.model';
import { layerWindowService, WindowHost, WindowService } from './window-service';

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

/** Marker the host double records when asked to close, so the tests can see it happened. */
const closedPlan = { bounds: { x: -1, y: -1, width: 0, height: 0 } } as unknown as WindowPlan;
const minimizedPlan = { bounds: { x: -2, y: -2, width: 0, height: 0 } } as unknown as WindowPlan;
const toggledPlan = { bounds: { x: -3, y: -3, width: 0, height: 0 } } as unknown as WindowPlan;

/** Test double for the Electron boundary: records every plan applied. */
const makeHostTestLayer = (applied: Ref.Ref<ReadonlyArray<WindowPlan>>) =>
  Layer.succeed(WindowHost, {
    workArea: Effect.succeed(workArea),
    apply: (plan) => Ref.update(applied, (all) => [...all, plan]).pipe(Effect.as(true)),
    close: Ref.update(applied, (all) => [...all, closedPlan]),
    minimize: Ref.update(applied, (all) => [...all, minimizedPlan]),
    toggleMaximize: Ref.update(applied, (all) => [...all, toggledPlan]),
    maximized: Stream.make(false, true),
  });

const provide = <A, E>(effect: Effect.Effect<A, E, WindowService>, applied: Ref.Ref<ReadonlyArray<WindowPlan>>) =>
  effect.pipe(Effect.provide(layerWindowService.pipe(Layer.provide(makeHostTestLayer(applied)))));

describe('WindowService', () => {
  it.effect('starts in the Pill without touching the window', () =>
    Effect.gen(function* () {
      const applied = yield* Ref.make<ReadonlyArray<WindowPlan>>([]);
      const mode = yield* provide(WindowService.use((s) => s.current), applied);
      expect(mode).toBe('Pill');
      expect(yield* Ref.get(applied)).toEqual([]);
    }),
  );

  it.effect('close asks the host to quit and leaves the mode alone', () =>
    Effect.gen(function* () {
      const applied = yield* Ref.make<ReadonlyArray<WindowPlan>>([]);
      const mode = yield* provide(
        Effect.gen(function* () {
          const windows = yield* WindowService;
          yield* windows.close;
          return yield* windows.current;
        }),
        applied,
      );
      expect(mode).toBe('Pill');
      expect(yield* Ref.get(applied)).toEqual([closedPlan]);
    }),
  );

  it.effect('keeps the mode when the host had no window to apply the plan to', () =>
    Effect.gen(function* () {
      const host = Layer.succeed(WindowHost, {
        workArea: Effect.succeed(workArea),
        apply: () => Effect.succeed(false),
        close: Effect.void,
        minimize: Effect.void,
        toggleMaximize: Effect.void,
        maximized: Stream.empty,
      });
      const mode = yield* Effect.gen(function* () {
        const windows = yield* WindowService;
        yield* windows.request('Panel');
        return yield* windows.current;
      }).pipe(Effect.provide(layerWindowService.pipe(Layer.provide(host))));
      expect(mode).toBe('Pill');
    }),
  );

  it.effect('applies the plan of the requested mode and reports it as current', () =>
    Effect.gen(function* () {
      const applied = yield* Ref.make<ReadonlyArray<WindowPlan>>([]);
      const mode = yield* provide(
        Effect.gen(function* () {
          const windows = yield* WindowService;
          yield* windows.request('Panel');
          return yield* windows.current;
        }),
        applied,
      );
      expect(mode).toBe('Panel');
      const plans = yield* Ref.get(applied);
      expect(plans).toHaveLength(1);
      expect(plans[0]).toMatchObject({ mode: 'Panel', alwaysOnTop: true, skipTaskbar: true });
    }),
  );

  it.effect('minimize and toggleMaximize go straight to the host and leave the mode alone', () =>
    Effect.gen(function* () {
      const applied = yield* Ref.make<ReadonlyArray<WindowPlan>>([]);
      const mode = yield* provide(
        Effect.gen(function* () {
          const windows = yield* WindowService;
          yield* windows.minimize;
          yield* windows.toggleMaximize;
          return yield* windows.current;
        }),
        applied,
      );
      expect(mode).toBe('Pill');
      expect(yield* Ref.get(applied)).toEqual([minimizedPlan, toggledPlan]);
    }),
  );

  it.effect('exposes the maximized state the host reports, as a stream', () =>
    Effect.gen(function* () {
      const applied = yield* Ref.make<ReadonlyArray<WindowPlan>>([]);
      const states = yield* provide(
        WindowService.use((s) => Stream.runCollect(s.maximized)),
        applied,
      );
      expect(Array.from(states)).toEqual([false, true]);
    }),
  );

  it.effect('ignores a request for the mode it is already in', () =>
    Effect.gen(function* () {
      const applied = yield* Ref.make<ReadonlyArray<WindowPlan>>([]);
      yield* provide(WindowService.use((s) => s.request('Pill')), applied);
      expect(yield* Ref.get(applied)).toEqual([]);
    }),
  );

  it.effect('leaving Expanded returns to the corner flags of the Pill', () =>
    Effect.gen(function* () {
      const applied = yield* Ref.make<ReadonlyArray<WindowPlan>>([]);
      yield* provide(
        Effect.gen(function* () {
          const windows = yield* WindowService;
          yield* windows.request('Expanded');
          yield* windows.request('Pill');
        }),
        applied,
      );
      const plans = yield* Ref.get(applied);
      expect(plans[0]).toMatchObject({ mode: 'Expanded', alwaysOnTop: false, skipTaskbar: false });
      expect(plans[1]).toMatchObject({ mode: 'Pill', alwaysOnTop: true, skipTaskbar: true });
    }),
  );
});
