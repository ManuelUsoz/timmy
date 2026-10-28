import { Injectable, type OnDestroy } from '@angular/core';
import { ManagedRuntime, type Effect, type Exit } from 'effect';
import type { DesktopApi } from './desktop-api';
import type { DesktopBridgeError } from './desktop-error';
import { layerDesktop } from './desktop-layers';

/**
 * The renderer's single Effect runtime.
 *
 * `ManagedRuntime` builds the app layer once and shares it across every run, so
 * layer memoization works and app-lifetime resources are disposed together.
 * Run effects here at the UI boundary; keep domain logic in services.
 */
@Injectable({ providedIn: 'root' })
export class EffectRuntime implements OnDestroy {
  private readonly runtime = ManagedRuntime.make(layerDesktop);

  /** Layer build failures (e.g. no desktop bridge) appear in the error channel. */
  run<A, E>(effect: Effect.Effect<A, E, DesktopApi>): Promise<Exit.Exit<A, E | DesktopBridgeError>> {
    return this.runtime.runPromiseExit(effect);
  }

  ngOnDestroy(): void {
    void this.runtime.dispose();
  }
}
