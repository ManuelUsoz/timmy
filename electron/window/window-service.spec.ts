import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Ref } from 'effect';
import type { WindowPlan } from '../../src/shared/window/window.model';
import { layerWindowService, WindowHost, WindowService } from './window-service';

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

/** Test double for the Electron boundary: records every plan applied. */
const makeHostTestLayer = (applied: Ref.Ref<ReadonlyArray<WindowPlan>>) =>
  Layer.succeed(WindowHost, {
    workArea: Effect.succeed(workArea),
    apply: (plan) => Ref.update(applied, (all) => [...all, plan]),
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
