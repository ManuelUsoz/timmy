import { Context, Effect, Layer, Option } from 'effect';
import { HooksError } from '../../src/shared/hooks/hooks-error.model';
import type { HookStatus } from '../../src/shared/hooks/hooks.model';
import type { Provider } from '../../src/shared/settings/settings.model';
import { SettingsStore } from '../settings/settings-store';
import { HookIntegrations } from './hook-integrations';

/** Settings → Hooks: which Providers' Hooks exist, which are on, and turning them on or off. */
export class HooksService extends Context.Service<HooksService, {
  /** The Providers that have a Hook and are enabled in Settings or still active, in Settings order. */
  readonly list: Effect.Effect<ReadonlyArray<HookStatus>, HooksError>;
  /** Only a Provider enabled in Settings can be activated; any active Hook can be deactivated. */
  readonly setActive: (provider: Provider, active: boolean) => Effect.Effect<ReadonlyArray<HookStatus>, HooksError>;
}>()('hooks/HooksService') {}

export const layerHooksService: Layer.Layer<HooksService, never, HookIntegrations | SettingsStore> = Layer.effect(
  HooksService,
  Effect.gen(function* () {
    const integrations = yield* HookIntegrations;
    const settings = yield* SettingsStore;

    const list = Effect.gen(function* () {
      const { providers } = yield* settings.get;
      const statuses = yield* Effect.forEach(integrations.all, (integration) =>
        integration.isActive.pipe(Effect.map((active): HookStatus => ({ provider: integration.provider, enabled: providers.includes(integration.provider), active }))),
      );
      return statuses.filter((status) => status.enabled || status.active);
    });

    return HooksService.of({
      list,
      setActive: Effect.fn('HooksService.setActive')(function* (provider, active) {
        const integration = integrations.get(provider);
        if (Option.isNone(integration)) return yield* new HooksError({ reason: 'ProviderHasNoHook', detail: `${provider} has no Hook` });
        if (active) {
          const { providers } = yield* settings.get;
          if (!providers.includes(provider)) {
            return yield* new HooksError({ reason: 'ProviderNotEnabled', detail: `${provider} is not enabled in Settings` });
          }
          yield* integration.value.activate;
        } else yield* integration.value.deactivate;
        return yield* list;
      }),
    });
  }),
);
