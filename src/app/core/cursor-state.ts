import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Effect, Stream } from 'effect';
import type { WindowPoint } from '../../shared/window/window.model';
import { DesktopApi } from './desktop-api';
import { EffectRuntime } from './effect-runtime';

/**
 * Where the cursor is, in the window's own coordinates, as main reports it (`Window.cursor`): anywhere on screen, so it can
 * be outside the window. Main only streams it while the Pill or Panel is visible, so the last position stays here while it
 * is quiet. Null until the first one arrives.
 */
@Injectable({ providedIn: 'root' })
export class CursorState {
  private readonly position = signal<WindowPoint | null>(null);
  readonly point = this.position.asReadonly();

  constructor() {
    const runtime = inject(EffectRuntime);
    const stop = new AbortController();
    inject(DestroyRef).onDestroy(() => stop.abort());
    // The gaze is a nicety: when the stream cannot be had, the eyes just look straight ahead.
    void runtime.run(
      Effect.flatMap(DesktopApi, (desktop) =>
        Stream.runForEach(desktop['Window.cursor'](), (point) => Effect.sync(() => this.position.set(point))),
      ),
      { signal: stop.signal },
    );
  }
}
