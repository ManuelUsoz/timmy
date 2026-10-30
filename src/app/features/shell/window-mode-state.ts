import { Injectable, inject, signal } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
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
    void this.runtime
      .run(Effect.gen(function* () {
          const desktop = yield* DesktopApi;
          return yield* desktop['Window.current']();
        }))
      .then(this.settle);
  }

  offered(): ReadonlyArray<WindowMode> {
    return offeredModes(this.mode());
  }

  request(mode: WindowMode): void {
    void this.runtime
      .run(Effect.gen(function* () {
          const desktop = yield* DesktopApi;
          return yield* desktop['Window.request']({ mode });
        }))
      .then(this.settle);
  }

  close(): void {
    void this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        return yield* desktop['Window.close']();
      }),
    );
  }

  private readonly settle = (exit: Exit.Exit<WindowMode, unknown>): void =>
    Exit.match(exit, {
      onFailure: (cause) => this.error.set(Cause.pretty(cause)),
      onSuccess: (mode) => this.mode.set(mode),
    });
}
