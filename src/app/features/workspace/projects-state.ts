import { Injectable, computed, inject, signal } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import type { Project } from '../../../shared/projects/projects.model';
import type { ProjectId } from '../../../shared/sessions/sessions.model';
import { DesktopApi, type DesktopApiShape } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { ToastService } from '../../core/toast';
import { filterProjects, sortProjects } from './project-search';

/** Loading, failure, empty and success stay apart: a failure is never shown as an empty list. */
export type Loadable<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly items: ReadonlyArray<T> };

/** Whether the folder of the selected project is on disk. `Checking` only until the first answer. */
export type FolderState = 'Checking' | 'Present' | 'Missing';

/**
 * UI state of the Projects area: the list and its search, the selected project, and whether its folder is
 * still there. The Terminals of a project live in `TerminalsState`.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsState {
  private readonly runtime = inject(EffectRuntime);
  private readonly toasts = inject(ToastService);

  readonly projects = signal<Loadable<Project>>({ status: 'loading' });
  readonly query = signal('');
  readonly selectedId = signal<ProjectId | undefined>(undefined);
  readonly folder = signal<FolderState>('Checking');
  /** Whether the last check of the folder failed, so a failure is told once and not on every window focus. */
  private folderCheckFailed = false;

  /** Bumped per selection, so a slower answer about a project that is no longer selected is dropped. */
  private selection = 0;

  readonly all = computed((): ReadonlyArray<Project> => {
    const list = this.projects();
    return list.status === 'ready' ? sortProjects(list.items) : [];
  });
  readonly visible = computed(() => filterProjects(this.all(), this.query()));
  readonly selected = computed(() => this.all().find((project) => project.projectId === this.selectedId()));

  /** Runs one RPC at the edge and hands the outcome to `onExit`. */
  private call<A, E>(f: (desktop: DesktopApiShape) => Effect.Effect<A, E>, onExit: (exit: Exit.Exit<A, unknown>) => void): Promise<void> {
    return this.runtime.run(Effect.flatMap(DesktopApi, f)).then(onExit);
  }

  /** Loads the list again. The first time the list is `loading`; later reloads leave what is on screen until the answer. */
  refresh(): Promise<void> {
    if (this.projects().status === 'failed') this.projects.set({ status: 'loading' });
    return this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Projects.list']())).then(
      Exit.match({
        onFailure: (cause) => {
          const detail = Cause.pretty(cause);
          this.projects.set({ status: 'failed', detail });
          this.toasts.error('projects.loadFailed', { detail });
        },
        onSuccess: (items) => this.projects.set({ status: 'ready', items }),
      }),
    );
  }

  /** Opens a project: remembers it as the last used and checks its folder. */
  select(projectId: ProjectId): void {
    if (this.selectedId() === projectId) return;
    const project = this.all().find((candidate) => candidate.projectId === projectId);
    if (project === undefined) return;
    this.selection++;
    this.selectedId.set(projectId);
    this.folder.set('Checking');
    this.folderCheckFailed = false;
    this.recheckFolder();
    void this.call((desktop) => desktop['Projects.markUsed']({ projectId }), () => undefined);
    const now = Date.now();
    this.projects.update((list) =>
      list.status === 'ready'
        ? { status: 'ready', items: list.items.map((item) => (item.projectId === projectId ? { ...item, lastUsedAt: now } : item)) }
        : list,
    );
  }

  deselect(): void {
    this.selection++;
    this.selectedId.set(undefined);
  }

  /** Asks main again whether the folder of the selected project is on disk. Called on opening and on window focus. */
  recheckFolder(): void {
    const projectId = this.selectedId();
    if (projectId === undefined) return;
    const selection = this.selection;
    void this.call(
      (desktop) => desktop['Projects.checkFolder']({ projectId }),
      Exit.match({
        onFailure: (cause) => {
          if (selection !== this.selection) return;
          if (!this.folderCheckFailed) this.toasts.error('projects.checkFailed', { detail: Cause.pretty(cause) });
          this.folderCheckFailed = true;
          if (this.folder() === 'Checking') this.folder.set('Present');
        },
        onSuccess: (status) => {
          if (selection !== this.selection) return;
          this.folderCheckFailed = false;
          this.folder.set(status);
        },
      }),
    );
  }

  /**
   * Takes the project out of the list and reloads it, whatever the answer, so the list shows what main has.
   * Resolves true when main removed it, so the caller can leave its route.
   */
  remove(projectId: ProjectId): Promise<boolean> {
    return this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Projects.remove']({ projectId }))).then(async (exit) => {
      const removed = Exit.isSuccess(exit);
      if (!removed) this.toasts.error('projects.removeFailed', { detail: Cause.pretty(exit.cause) });
      if (removed && this.selectedId() === projectId) this.deselect();
      await this.refresh();
      return removed;
    });
  }
}
