import { Injectable, inject, signal } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import type { HookStatus } from '../../shared/hooks/hooks.model';
import type { Provider } from '../../shared/settings/settings.model';
import { DesktopApi } from './desktop-api';
import { EffectRuntime } from './effect-runtime';
import { ToastService } from './toast';

/** What the renderer knows about the Hooks of the Providers. */
export type HookSettingsState =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly hooks: ReadonlyArray<HookStatus> };

/**
 * The Hooks Settings shows, kept in main. A change is shown once main has written it into the Provider's config,
 * so what the screen says is what the Provider will do; if main cannot, nothing changes and a toast says so.
 */
@Injectable({ providedIn: 'root' })
export class HookSettings {
  private readonly runtime = inject(EffectRuntime);
  private readonly toasts = inject(ToastService);

  private readonly current = signal<HookSettingsState>({ status: 'loading' });
  readonly state = this.current.asReadonly();

  /** Reads the list again. What is on screen stays until the answer comes, so reopening the section does not flash. */
  refresh(): void {
    void this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Hooks.list']())).then((exit) => {
      this.current.set(Exit.isSuccess(exit) ? { status: 'ready', hooks: exit.value } : { status: 'failed', detail: Cause.pretty(exit.cause) });
    });
  }

  setActive(provider: Provider, active: boolean): void {
    void this.runtime
      .run(Effect.flatMap(DesktopApi, (desktop) => desktop['Hooks.setActive']({ provider, active })))
      .then((exit) => {
        if (Exit.isSuccess(exit)) this.current.set({ status: 'ready', hooks: exit.value });
        else this.toasts.error('settings.hooks.saveFailed', { detail: Cause.pretty(exit.cause) });
      });
  }
}
