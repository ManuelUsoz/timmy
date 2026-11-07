import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';

/** Tailwind's default breakpoints, which the Workspace follows (ADR 0005). */
export const BREAKPOINT_LG = 1024;
export const BREAKPOINT_XL = 1280;

/** What the user chose by hand; `null` means they have not, so the width decides. */
export type ManualSidebar = 'expanded' | 'collapsed' | null;

export interface WorkspaceLayout {
  /** The sidebar: full, or collapsed to its 48 px strip. */
  readonly sidebar: 'expanded' | 'collapsed';
  /** The project's content: its own column, or an overlay opened on demand. */
  readonly content: 'column' | 'overlay';
}

/**
 * The sidebar is full from `xl` and collapses below it; below `lg` the content becomes an overlay too. A manual
 * choice for the sidebar wins over the automatic one at every width.
 */
export const layoutFor = (width: number, manual: ManualSidebar): WorkspaceLayout => ({
  sidebar: manual ?? (width >= BREAKPOINT_XL ? 'expanded' : 'collapsed'),
  content: width >= BREAKPOINT_LG ? 'column' : 'overlay',
});

/** UI state of the Workspace columns. Lives for the app so the choice survives leaving and re-entering a route. */
@Injectable({ providedIn: 'root' })
export class WorkspaceLayoutState {
  readonly width = signal(window.innerWidth);
  private readonly manual = signal<ManualSidebar>(null);
  private readonly overlayRequested = signal(false);

  readonly layout = computed(() => layoutFor(this.width(), this.manual()));
  /** The overlay is only ever open while the content has no column of its own. */
  readonly contentOpen = computed(() => this.layout().content === 'overlay' && this.overlayRequested());

  constructor() {
    const onResize = () => this.width.set(window.innerWidth);
    window.addEventListener('resize', onResize);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('resize', onResize));
  }

  /** Ctrl+B, or the sidebar's own button: flips what is showing, and the choice then sticks through resizes. */
  toggleSidebar(): void {
    this.manual.set(this.layout().sidebar === 'expanded' ? 'collapsed' : 'expanded');
  }

  toggleContent(): void {
    this.overlayRequested.update((open) => !open);
  }
}
