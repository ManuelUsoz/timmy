import { DestroyRef, Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Cause, Effect, Exit, Stream } from 'effect';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { ProjectLayout } from '../../../shared/workspace/workspace.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { ToastService } from '../../core/toast';
import { TabsState } from './tabs-state';
import { TerminalsState } from './terminals-state';

/** How long after a change the Project's Tabs are saved: a divider being dragged changes the layout many times a second. */
export const SAVE_AFTER_MS = 250;

/** What a Project that never had a Terminal looks like saved. */
const NOTHING_SAVED = JSON.stringify({ tabs: [], lastNumber: 0 });

/**
 * Keeps the layout across restarts (ADR 0011). When the app starts it loads each Project's saved Tabs, Panes, sizes,
 * Stack order and Terminals into `TabsState`, the Terminals Idle; from then on it saves a Project's Tabs whenever they
 * change, so closing a Tab, Pane or View removes its Terminals from the store too. Nothing is saved before the load has
 * finished, and none if it failed: an empty Workspace must never replace the saved one. When Timmy is about to quit,
 * main asks; what waits to be saved is sent at once, and main is told once it is in, so a last change is not lost.
 */
@Injectable({ providedIn: 'root' })
export class WorkspacePersistence {
  private readonly runtime = inject(EffectRuntime);
  private readonly tabs = inject(TabsState);
  private readonly terminals = inject(TerminalsState);
  private readonly toasts = inject(ToastService);
  /** Whether the saved Tabs are in; saving starts then. */
  private readonly loaded = signal(false);
  /** What the store holds for each Project, as JSON, so only a real change is saved. */
  private readonly saved = new Map<ProjectId, string>();
  private readonly dirty = new Set<ProjectId>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** Saves go one after the other, so a slow one cannot land after the one that follows it. */
  private queue: Promise<void> = Promise.resolve();
  private saveFailureTold = false;

  constructor() {
    const onHide = () => this.flush();
    window.addEventListener('pagehide', onHide);
    const stop = new AbortController();
    inject(DestroyRef).onDestroy(() => {
      window.removeEventListener('pagehide', onHide);
      clearTimeout(this.timer);
      stop.abort();
    });
    void this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) =>
        Stream.runForEach(desktop['Workspace.quitting'](), () =>
          // One answer main did not get must not stop the window listening for the next quit.
          Effect.promise(() => this.saveNow()).pipe(Effect.andThen(desktop['Workspace.saved']()), Effect.ignore),
        ),
      ),
      { signal: stop.signal },
    );
    effect(() => {
      if (!this.loaded()) return;
      // Read here, so a change to any Tab, Terminal, name or layout runs this again.
      const now = this.current();
      untracked(() => this.schedule(now));
    });
    void this.load();
  }

  private async load(): Promise<void> {
    const exit = await this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Workspace.load']()));
    if (Exit.isFailure(exit)) {
      this.toasts.error('workspace.loadFailed', { detail: Cause.pretty(exit.cause) });
      return;
    }
    // A Project that already had a Terminal open when the load finished has a change the store does not hold yet.
    const opened = new Set(this.terminals.entries().map((entry) => entry.projectId));
    this.tabs.restore(exit.value);
    // What is saved is the layout as it is now, tidied to its Terminals, so a clean start writes nothing back.
    for (const { projectId } of exit.value) {
      if (!opened.has(projectId)) this.saved.set(projectId, JSON.stringify(this.snapshot(projectId)));
    }
    this.loaded.set(true);
  }

  /** Every Project with Terminals, or with something saved, as it would be saved now (JSON). */
  private current(): ReadonlyMap<ProjectId, string> {
    const projects = new Set([...this.terminals.entries().map((entry) => entry.projectId), ...this.saved.keys()]);
    return new Map(Array.from(projects, (projectId) => [projectId, JSON.stringify(this.snapshot(projectId))] as const));
  }

  /**
   * Sends what is not saved yet, the latest change included even before the effect has seen it, and resolves once every
   * save sent so far has landed (or failed). Nothing is saved before the load has finished.
   */
  private async saveNow(): Promise<void> {
    if (this.loaded()) this.schedule(this.current());
    this.flush();
    await this.queue;
  }

  /** What is saved of a Project: its Tabs and the highest number it has given a Terminal. */
  private snapshot(projectId: ProjectId): Omit<ProjectLayout, 'projectId'> {
    return { tabs: this.tabs.savedTabs(projectId), lastNumber: this.terminals.lastNumberOf(projectId) };
  }

  private schedule(now: ReadonlyMap<ProjectId, string>): void {
    for (const [projectId, json] of now) {
      // A Project with no Tabs, and none saved, has nothing to say.
      if ((this.saved.get(projectId) ?? NOTHING_SAVED) === json) continue;
      this.saved.set(projectId, json);
      this.dirty.add(projectId);
    }
    if (this.dirty.size === 0) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SAVE_AFTER_MS);
  }

  /** Sends what changed now, instead of waiting for the quiet. */
  private flush(): void {
    clearTimeout(this.timer);
    const projects = Array.from(this.dirty);
    this.dirty.clear();
    for (const projectId of projects) {
      const { tabs, lastNumber } = this.snapshot(projectId);
      this.queue = this.queue.then(async () => {
        const exit = await this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Workspace.save']({ projectId, tabs, lastNumber })));
        if (Exit.isSuccess(exit)) return;
        // The store still holds the old layout: the next change to the Project saves it again.
        this.saved.delete(projectId);
        if (!this.saveFailureTold) {
          this.saveFailureTold = true;
          this.toasts.error('workspace.saveFailed', { detail: Cause.pretty(exit.cause) });
        }
      });
    }
  }
}
