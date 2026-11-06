import { DestroyRef, Injectable, inject, signal } from '@angular/core';

/** Whether the user asked the system for reduced motion. Anything that moves on its own beyond small cues stays still on it. */
@Injectable({ providedIn: 'root' })
export class ReducedMotion {
  private readonly query = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  private readonly asked = signal(this.query?.matches ?? false);
  readonly reduced = this.asked.asReadonly();

  constructor() {
    const query = this.query;
    if (query === null) return;
    const update = () => this.asked.set(query.matches);
    query.addEventListener('change', update);
    inject(DestroyRef).onDestroy(() => query.removeEventListener('change', update));
  }
}
