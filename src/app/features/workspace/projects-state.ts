import { Injectable, computed, inject, signal } from '@angular/core';
import { Cause, Effect, Exit, Stream } from 'effect';
import type { RpcClientError } from 'effect/rpc';
import type { SessionId } from '../../../shared/chat/ids.model';
import type { Project } from '../../../shared/projects/projects.model';
import type { ProjectId, SessionSummary } from '../../../shared/sessions/sessions.model';
import type { SessionsError } from '../../../shared/sessions/sessions-error.model';
import { DesktopApi, type DesktopApiShape } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { ToastService } from '../../core/toast';
import { ChatController } from '../chat/chat-controller';
import { filterProjects, sortProjects } from './project-search';
import { failureKey, failureTone, type SessionActionFailure } from './session-actions';
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
  private readonly toasts = inject(ToastService);

  readonly projects = signal<Loadable<Project>>({ status: 'loading' });
  readonly query = signal('');
  readonly selectedId = signal<ProjectId | undefined>(undefined);
  readonly folder = signal<FolderState>('Checking');
  /** Whether the last check of the folder failed, so a failure is told once and not on every window focus. */
  private folderCheckFailed = false;
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
    const reload = Effect.sync(() => void this.loadSessions(false));
    const changes = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* Stream.runForEach(desktop['Sessions.changes'](), () => reload);
    });
    void this.runtime.run(changes);
  }

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

  /** Opens a project: remembers it as the last used, checks its folder and loads its sessions. */
  select(projectId: ProjectId): void {
    if (this.selectedId() === projectId) return;
    const project = this.all().find((candidate) => candidate.projectId === projectId);
    if (project === undefined) return;
    this.selection++;
    this.selectedId.set(projectId);
    this.folder.set('Checking');
    this.folderCheckFailed = false;
    this.sessions.set({ status: 'loading' });
    void this.loadSessions(true);
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
    this.sessions.set({ status: 'loading' });
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

  /** `showLoading` is off for pushed updates, so the list does not flash. */
  loadSessions(showLoading: boolean): Promise<void> {
    const project = this.selected();
    if (project === undefined) return Promise.resolve();
    const selection = this.selection;
    if (showLoading) this.sessions.set({ status: 'loading' });
    return this.call(
      (desktop) => desktop['Sessions.list']({ cwd: project.cwd }),
      Exit.match({
        onFailure: (cause) => {
          if (selection !== this.selection) return;
          const detail = Cause.pretty(cause);
          this.sessions.set({ status: 'failed', detail });
          this.toasts.error('sessions.loadFailed', { detail });
        },
        onSuccess: (items) => selection === this.selection && this.sessions.set({ status: 'ready', items }),
      }),
    );
  }

  /**
   * Starts a session in the selected project, opens it in the chat and reloads the list so it is on it.
   * Resolves with the new session, or undefined after telling the user why there is none in a toast.
   */
  async createSession(): Promise<SessionSummary | undefined> {
    const project = this.selected();
    if (project === undefined) return undefined;
    const outcome = await this.chat.startNewSession(project.cwd);
    switch (outcome.status) {
      case 'busy':
        this.tell({ action: 'New', reason: 'Busy', detail: 'A Turn is running' });
        return undefined;
      case 'failed':
        this.tell({ action: 'New', reason: 'Failed', detail: outcome.detail });
        return undefined;
      case 'started': {
        await this.loadSessions(false);
        const list = this.sessions();
        return list.status === 'ready' ? list.items.find((session) => session.sessionId === outcome.sessionId) : undefined;
      }
    }
  }

  /** Renames a session. Resolves true when main did; otherwise a toast says why. The list is reloaded either way. */
  renameSession(sessionId: SessionId, title: string): Promise<boolean> {
    return this.change('Rename', (desktop) => desktop['Sessions.rename']({ sessionId, title }));
  }

  /**
   * Deletes a session. Main refuses with `SessionActive` while it is open, and a warning toast says so; a stored
   * session that was on screen leaves the chat. Resolves true when it is gone.
   */
  async deleteSession(sessionId: SessionId): Promise<boolean> {
    const deleted = await this.change('Delete', (desktop) => desktop['Sessions.delete']({ sessionId }));
    if (deleted && this.chat.selectedSessionId() === sessionId) this.chat.clearChat();
    return deleted;
  }

  /** Runs a change of a stored session, tells the user what failed and reloads the list whatever the answer. */
  private async change(
    action: 'Rename' | 'Delete',
    f: (desktop: DesktopApiShape) => Effect.Effect<void, SessionsError | RpcClientError.RpcClientError>,
  ): Promise<boolean> {
    const program = Effect.flatMap(DesktopApi, f).pipe(
      Effect.as(null),
      Effect.catchTag('SessionsError', (error) =>
        Effect.succeed<SessionActionFailure>({ action, reason: error.reason, detail: error.detail }),
      ),
    );
    const exit = await this.runtime.run(program);
    const failure: SessionActionFailure | null = Exit.isSuccess(exit)
      ? exit.value
      : { action, reason: 'Failed', detail: Cause.pretty(exit.cause) };
    if (failure !== null) this.tell(failure);
    await this.loadSessions(false);
    return failure === null;
  }

  /** Tells the user why an action on a session did not happen; the technical detail goes in the tooltip. */
  private tell(failure: SessionActionFailure): void {
    this.toasts.show({ tone: failureTone(failure), body: failureKey(failure), detail: failure.detail });
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
