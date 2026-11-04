import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Option, Ref } from 'effect';
import type { Provider } from '../../src/shared/settings/settings.model';
import { defaultSettings } from '../../src/shared/settings/settings.model';
import { layerSettingsStoreTest } from '../settings/settings-store';
import type { HookIntegration } from './hook-integration';
import { layerHookIntegrationsTest } from './hook-integrations';
import { HooksService, layerHooksService } from './hooks-service';

/** A Provider whose Hook is a flag. */
const fakeHook = (provider: Provider, active = false) =>
  Effect.gen(function* () {
    const on = yield* Ref.make(active);
    const integration: HookIntegration = {
      provider,
      isActive: Ref.get(on),
      activate: Ref.set(on, true),
      deactivate: Ref.set(on, false),
      decode: () => Option.none(),
    };
    return integration;
  });

const setup = (options: { enabled?: ReadonlyArray<Provider>; active?: boolean } = {}) =>
  Effect.gen(function* () {
    const claude = yield* fakeHook('ClaudeCode', options.active);
    return layerHooksService.pipe(
      Layer.provide(layerHookIntegrationsTest([claude])),
      Layer.provide(layerSettingsStoreTest({ ...defaultSettings, providers: options.enabled ?? [] })),
    );
  });

describe('HooksService', () => {
  it.effect('lists only Providers that have a Hook, and only when they are enabled', () =>
    Effect.gen(function* () {
      const none = yield* setup({ enabled: ['OpenCode', 'Codex'] });
      expect(yield* HooksService.use((s) => s.list).pipe(Effect.provide(none))).toEqual([]);
      const enabled = yield* setup({ enabled: ['OpenCode', 'ClaudeCode'] });
      expect(yield* HooksService.use((s) => s.list).pipe(Effect.provide(enabled))).toEqual([{ provider: 'ClaudeCode', enabled: true, active: false }]);
    }),
  );

  it.effect('activates and deactivates the Hook of an enabled Provider', () =>
    Effect.gen(function* () {
      const layer = yield* setup({ enabled: ['ClaudeCode'] });
      yield* Effect.gen(function* () {
        const hooks = yield* HooksService;
        expect(yield* hooks.setActive('ClaudeCode', true)).toEqual([{ provider: 'ClaudeCode', enabled: true, active: true }]);
        expect(yield* hooks.list).toEqual([{ provider: 'ClaudeCode', enabled: true, active: true }]);
        expect(yield* hooks.setActive('ClaudeCode', false)).toEqual([{ provider: 'ClaudeCode', enabled: true, active: false }]);
      }).pipe(Effect.provide(layer));
    }),
  );

  it.effect('refuses to activate the Hook of a Provider that is not enabled in Settings', () =>
    Effect.gen(function* () {
      const layer = yield* setup({ enabled: [] });
      const error = yield* HooksService.use((s) => s.setActive('ClaudeCode', true)).pipe(Effect.flip, Effect.provide(layer));
      expect(error.reason).toBe('ProviderNotEnabled');
    }),
  );

  it.effect('refuses a Provider that has no Hook', () =>
    Effect.gen(function* () {
      const layer = yield* setup({ enabled: ['Codex'] });
      const error = yield* HooksService.use((s) => s.setActive('Codex', true)).pipe(Effect.flip, Effect.provide(layer));
      expect(error.reason).toBe('ProviderHasNoHook');
    }),
  );

  it.effect('a Hook that is active stays listed and can be deactivated after its Provider is disabled', () =>
    Effect.gen(function* () {
      const layer = yield* setup({ enabled: [], active: true });
      yield* Effect.gen(function* () {
        const hooks = yield* HooksService;
        expect(yield* hooks.list).toEqual([{ provider: 'ClaudeCode', enabled: false, active: true }]);
        expect(yield* hooks.setActive('ClaudeCode', false)).toEqual([]);
      }).pipe(Effect.provide(layer));
    }),
  );
});
