import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Cause, Effect, Exit, Stream } from 'effect';
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
  /** Mirrors main's maximized state; the window has no system controls, so main pushes every change. */
  readonly maximized = signal(false);

  constructor() {
    void this.call((desktop) => desktop['Window.current']()).then(this.settle);
    const stop = new AbortController();
    inject(DestroyRef).onDestroy(() => stop.abort());
    void this.runtime
      .run(
        Effect.flatMap(DesktopApi, (desktop) =>
          Stream.runForEach(desktop['Window.maximized'](), (value) => Effect.sync(() => this.maximized.set(value))),
        ),
        { signal: stop.signal },
      )
      .then((exit) => {
        if (Exit.isFailure(exit) && !stop.signal.aborted) this.error.set(Cause.pretty(exit.cause));
      });
  }

  readonly offered = computed(() => offeredModes(this.mode()));

  request(mode: WindowMode): void {
    void this.call((desktop) => desktop['Window.request']({ mode })).then(this.settle);
  }

  close(): void {
    this.fire((desktop) => desktop['Window.close']());
  }

  minimize(): void {
    this.fire((desktop) => desktop['Window.minimize']());
  }

  toggleMaximize(): void {
    this.fire((desktop) => desktop['Window.toggleMaximize']());
  }

  private fire<E>(f: (desktop: DesktopApiShape) => Effect.Effect<void, E>): void {
    void this.call(f).then((exit) =>
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
