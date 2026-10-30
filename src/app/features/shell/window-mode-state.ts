import { Injectable, computed, inject, signal } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import type { DesktopApiShape } from '../../core/desktop-api';
import { offeredModes, startupMode, type WindowMode } from '../../../shared/window/window.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';

/** The Window mode the renderer is showing. Main owns the window; this only asks and mirrors. */
@Injectable({ providedIn: 'root' })
export class WindowModeState {
  private readonly runtime = inject(EffectRuntime);

  readonly mode = signal<WindowMode>(startupMode);
  readonly error = signal<string | null>(null);

  constructor() {
    void this.call((desktop) => desktop['Window.current']()).then(this.settle);
  }

  readonly offered = computed(() => offeredModes(this.mode()));

  request(mode: WindowMode): void {
    void this.call((desktop) => desktop['Window.request']({ mode })).then(this.settle);
  }

  close(): void {
    void this.call((desktop) => desktop['Window.close']()).then((exit) =>
      Exit.match(exit, { onFailure: (cause) => this.error.set(Cause.pretty(cause)), onSuccess: () => undefined }),
    );
  }

  private call<A, E>(f: (desktop: DesktopApiShape) => Effect.Effect<A, E>) {
    return this.runtime.run(Effect.flatMap(DesktopApi, f));
  }

  private readonly settle = (exit: Exit.Exit<WindowMode, unknown>): void =>
    Exit.match(exit, {
      onFailure: (cause) => this.error.set(Cause.pretty(cause)),
      onSuccess: (mode) => {
        this.error.set(null);
        this.mode.set(mode);
      },
    });
}
