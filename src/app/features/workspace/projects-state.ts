import { Injectable, computed, inject, signal } from '@angular/core';
import { Cause, Effect, Exit, Stream } from 'effect';
import type { SessionId } from '../../../shared/chat/ids.model';
import type { Project } from '../../../shared/projects/projects.model';
import type { ProjectId, SessionSummary } from '../../../shared/sessions/sessions.model';
import { DesktopApi, type DesktopApiShape } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { ChatController } from '../chat/chat-controller';
import { filterProjects, sortProjects } from './project-search';
import { sessionStateOf, stateTone, type SessionState } from './session-state';
import type { StateTone } from '../../shared/ui/state/state';
import type { PanelSession } from './workspace-entry';

/** Loading, failure, empty and success stay apart: a failure is never shown as an empty list. */
export type Loadable<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly items: ReadonlyArray<T> };

/** Whether the folder of the selected project is on disk. `Checking` only until the first answer. */
export type FolderState = 'Checking' | 'Present' | 'Missing';

/** The number of live sessions of a project, and the tone that says how live they are. */
export interface LiveBadge {
  readonly count: number;
  readonly tone: StateTone;
}

/**
 * UI state of the Projects area: the list and its search, the selected project, whether its folder is still
 * there, and its sessions. The state of a session comes from the chat, which only knows the one that is open.
 */
@Injectable({ providedIn: 'root' })
export class ProjectsState {
  private readonly runtime = inject(EffectRuntime);
  private readonly chat = inject(ChatController);

  readonly projects = signal<Loadable<Project>>({ status: 'loading' });
  readonly query = signal('');
  readonly selectedId = signal<ProjectId | undefined>(undefined);
  readonly folder = signal<FolderState>('Checking');
  /** Why the folder of the selected project could not be checked, if it could not. */
  readonly folderFailure = signal<string | null>(null);
  readonly sessions = signal<Loadable<SessionSummary>>({ status: 'loading' });

  /** Bumped per selection, so a slower answer about a project that is no longer selected is dropped. */
  private selection = 0;

  readonly all = computed((): ReadonlyArray<Project> => {
    const list = this.projects();
    return list.status === 'ready' ? sortProjects(list.items) : [];
  });
  readonly visible = computed(() => filterProjects(this.all(), this.query()));
  readonly selected = computed(() => this.all().find((project) => project.projectId === this.selectedId()));

  /** The Panel's live session and its project, which is where the Workspace opens first. */
  readonly panelSession = computed((): PanelSession | undefined => {
    const session = this.chat.liveSession();
    return session === undefined ? undefined : { projectId: session.projectId, sessionId: session.sessionId };
  });

  private readonly openProjectId = computed(() => {
    const open = this.chat.selectedSessionId();
    if (open === undefined) return undefined;
    const known = this.sessions();
    const candidates = [...(known.status === 'ready' ? known.items : []), ...this.chat.sessions()];
    return candidates.find((session) => session.sessionId === open)?.projectId;
  });

  /** Live badges by project: only the project of the open session can have one, and only while it is Live or Asks. */
  readonly badges = computed((): ReadonlyMap<ProjectId, LiveBadge> => {
    const projectId = this.openProjectId();
    const state = sessionStateOf(this.chat.chat(), true);
    if (projectId === undefined || state === 'Idle') return new Map();
    return new Map([[projectId, { count: 1, tone: stateTone(state) }]]);
  });

  /** The state a session row shows: real for the open session, Idle for the rest. */
  stateOf(sessionId: SessionId): SessionState {
    return sessionStateOf(this.chat.chat(), this.chat.selectedSessionId() === sessionId);
  }

  constructor() {
    // Main pushes a value whenever stored sessions change (the Panel started one, a title arrived).
    const reload = Effect.sync(() => this.loadSessions(false));
    const changes = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* Stream.runForEach(desktop['Sessions.changes'](), () => reload);
    });
    void this.runtime.run(changes);
  }

  /** Runs one RPC at the edge and hands the outcome to `onExit`. */
  private call<A, E>(f: (desktop: DesktopApiShape) => Effect.Effect<A, E>, onExit: (exit: Exit.Exit<A, unknown>) => void): void {
    void this.runtime.run(Effect.flatMap(DesktopApi, f)).then(onExit);
  }

  /** Loads the list again. The first time the list is `loading`; later reloads leave what is on screen until the answer. */
  refresh(): Promise<void> {
    if (this.projects().status === 'failed') this.projects.set({ status: 'loading' });
    return this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Projects.list']())).then(
      Exit.match({
        onFailure: (cause) => this.projects.set({ status: 'failed', detail: Cause.pretty(cause) }),
        onSuccess: (items) => this.projects.set({ status: 'ready', items }),
      }),
    );
  }

  /** Opens a project: remembers it as the last used, checks its folder and loads its sessions. */
  select(projectId: ProjectId): void {
    if (this.selectedId() === projectId) return;
    const project = this.all().find((candidate) => candidate.projectId === projectId);
    if (project === undefined) return;
    this.selection++;
    this.selectedId.set(projectId);
    this.folder.set('Checking');
    this.folderFailure.set(null);
    this.sessions.set({ status: 'loading' });
    this.loadSessions(true);
    this.recheckFolder();
    this.call((desktop) => desktop['Projects.markUsed']({ projectId }), () => undefined);
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
    this.sessions.set({ status: 'loading' });
  }

  /** Asks main again whether the folder of the selected project is on disk. Called on opening and on window focus. */
  recheckFolder(): void {
    const projectId = this.selectedId();
    if (projectId === undefined) return;
    const selection = this.selection;
    this.call(
      (desktop) => desktop['Projects.checkFolder']({ projectId }),
      Exit.match({
        onFailure: (cause) => {
          if (selection !== this.selection) return;
          this.folderFailure.set(Cause.pretty(cause));
          if (this.folder() === 'Checking') this.folder.set('Present');
        },
        onSuccess: (status) => {
          if (selection !== this.selection) return;
          this.folderFailure.set(null);
          this.folder.set(status);
        },
      }),
    );
  }

  /** `showLoading` is off for pushed updates, so the list does not flash. */
  loadSessions(showLoading: boolean): void {
    const project = this.selected();
    if (project === undefined) return;
    const selection = this.selection;
    if (showLoading) this.sessions.set({ status: 'loading' });
    this.call(
      (desktop) => desktop['Sessions.list']({ cwd: project.cwd }),
      Exit.match({
        onFailure: (cause) => selection === this.selection && this.sessions.set({ status: 'failed', detail: Cause.pretty(cause) }),
        onSuccess: (items) => selection === this.selection && this.sessions.set({ status: 'ready', items }),
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
      if (removed && this.selectedId() === projectId) this.deselect();
      await this.refresh();
      return removed;
    });
  }
}
