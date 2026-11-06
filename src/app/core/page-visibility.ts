import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Whether the page can be seen: false while the window is hidden or minimized. Anything that animates on its own pauses on it. */
@Injectable({ providedIn: 'root' })
export class PageVisibility {
  private readonly shown = signal(!document.hidden);
  readonly visible = this.shown.asReadonly();

  constructor() {
    const update = () => this.shown.set(!document.hidden);
    document.addEventListener('visibilitychange', update);
    inject(DestroyRef).onDestroy(() => document.removeEventListener('visibilitychange', update));
  }
}
