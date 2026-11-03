import { Injectable, computed, inject, signal } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import type { Provider } from '../../shared/settings/settings.model';
import { DesktopApi } from './desktop-api';
import { EffectRuntime } from './effect-runtime';
import { ToastService } from './toast';

/** What the renderer knows about the Providers the user enabled. */
export type ProviderSettingsState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly providers: ReadonlyArray<Provider> };

/**
 * The Providers the user chose to use, kept in main. A change is shown once main has stored it, so what the
 * screen says is always what survives a restart; if main cannot store it, nothing changes and a toast says so.
 */
@Injectable({ providedIn: 'root' })
export class ProviderSettings {
  private readonly runtime = inject(EffectRuntime);
  private readonly toasts = inject(ToastService);

  private readonly current = signal<ProviderSettingsState>({ status: 'loading' });
  readonly state = this.current.asReadonly();

  /** The enabled Providers, in the order Settings lists them. Empty while loading or when reading failed. */
  readonly enabled = computed<ReadonlyArray<Provider>>(() => {
    const state = this.current();
    return state.status === 'ready' ? state.providers : [];
  });

  constructor() {
    void this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Settings.get']())).then((exit) => {
      // A change made while the first read was in flight is newer than the read.
      if (this.current().status !== 'loading') return;
      this.current.set(Exit.isSuccess(exit) ? { status: 'ready', providers: exit.value.providers } : { status: 'failed', detail: Cause.pretty(exit.cause) });
    });
  }

  /** Main answers each change with the whole settings; only the answer to the newest change is current. */
  private issued = 0;
  private applied = 0;

  set(provider: Provider, enabled: boolean): void {
    const sequence = ++this.issued;
    void this.runtime
      .run(Effect.flatMap(DesktopApi, (desktop) => desktop['Settings.setProvider']({ provider, enabled })))
      .then((exit) => {
        if (Exit.isSuccess(exit)) {
          if (sequence < this.applied) return;
          this.applied = sequence;
          this.current.set({ status: 'ready', providers: exit.value.providers });
        } else this.toasts.error('settings.providers.saveFailed', { detail: Cause.pretty(exit.cause) });
      });
  }
}
