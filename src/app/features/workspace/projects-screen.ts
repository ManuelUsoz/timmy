import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Router } from '@angular/router';
import { SessionId } from '../../../shared/chat/ids.model';
import type { Project } from '../../../shared/projects/projects.model';
import { ProjectId, type SessionSummary } from '../../../shared/sessions/sessions.model';
import { I18n } from '../../core/i18n';
import { ToastService } from '../../core/toast';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ChatController } from '../chat/chat-controller';
import { ChatViewComponent } from '../chat/chat-view';
import { NewProjectDialog } from './new-project-dialog';
import { ProjectContent } from './project-content';
import { ProjectList } from './project-list';
import { ProjectsState } from './projects-state';
import { WorkspaceHero } from './workspace-hero';
import { WorkspaceLayoutState } from './workspace-layout';
import { entryPath, entryTarget } from './workspace-entry';

/**
 * Projects: the list, the content of the selected project and the open session. One component serves
 * `/projects`, `/projects/:projectId` and `/projects/:projectId/sessions/:sessionId` (see `workspace.routes`),
 * so moving between them keeps the columns in place. The route decides what is open; this screen makes the
 * state follow it.
 */
@Component({
  selector: 'app-projects-screen',
  imports: [ButtonComponent, ChatViewComponent, NewProjectDialog, ProjectContent, ProjectList, WorkspaceHero],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-screen.html',
  styleUrl: './projects-screen.css',
})
export class ProjectsScreen {
  protected readonly i18n = inject(I18n);
  protected readonly layout = inject(WorkspaceLayoutState);
  protected readonly state = inject(ProjectsState);
  private readonly chat = inject(ChatController);
  private readonly router = inject(Router);
  private readonly toasts = inject(ToastService);

  /** Path parameters of the route, bound to inputs. */
  readonly projectId = input<string>();
  readonly sessionId = input<string>();

  protected readonly dialogOpen = signal(false);
  /** A new session is being started, so the buttons that start one wait. */
  protected readonly creating = signal(false);

  protected readonly routeSessionId = computed(() => {
    const id = this.sessionId();
    return id === undefined ? undefined : SessionId.make(id);
  });

  /** The session of the route, once the project's sessions are loaded and it is one of them. */
  protected readonly openSession = computed((): SessionSummary | undefined => {
    const list = this.state.sessions();
    const id = this.routeSessionId();
    return list.status === 'ready' && id !== undefined ? list.items.find((session) => session.sessionId === id) : undefined;
  });

  protected readonly listReady = computed(() => this.state.projects().status === 'ready');
  protected readonly hasProjects = computed(() => this.state.all().length > 0);
  protected readonly folderMissing = computed(() => this.state.selected() !== undefined && this.state.folder() === 'Missing');
  /** The project's content column exists whenever a project is open and its folder is there. */
  protected readonly showsContent = computed(() => this.state.selected() !== undefined && !this.folderMissing());

  constructor() {
    void this.state.refresh();

    // The route says what is open; the state follows it once the list is known.
    effect(() => {
      const list = this.state.projects();
      const id = this.projectId();
      if (list.status !== 'ready') return;
      untracked(() => this.follow(list.items, id));
    });

    // A session in the route opens in the chat, unless it is already the one on screen.
    effect(() => {
      const sessions = this.state.sessions();
      const id = this.routeSessionId();
      const selected = this.state.selectedId();
      if (id === undefined || selected === undefined || selected !== this.projectId() || sessions.status !== 'ready') return;
      untracked(() => {
        const session = sessions.items.find((candidate) => candidate.sessionId === id);
        if (session === undefined) {
          void this.router.navigate(['/projects', selected], { replaceUrl: true });
        } else if (this.chat.selectedSessionId() !== id && !this.chat.openStoredSession(session)) {
          // Another session has a Turn running, which cannot be switched away from: say so and stay on the project.
          this.toasts.warning('sessions.busy');
          void this.router.navigate(['/projects', selected], { replaceUrl: true });
        }
      });
    });

    // The folder may come back, or go away, while the app is in the background.
    const onFocus = () => this.state.recheckFolder();
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('focus', onFocus));
  }

  /** Aligns the selection with the route; `/projects` alone goes where entering the Workspace should. */
  private follow(projects: ReadonlyArray<Project>, id: string | undefined): void {
    if (id === undefined) {
      const target = entryTarget(projects, this.state.panelSession());
      if (target === undefined) this.state.deselect();
      else void this.router.navigate(entryPath(target), { replaceUrl: true });
      return;
    }
    const projectId = ProjectId.make(id);
    if (projects.some((project) => project.projectId === projectId)) this.state.select(projectId);
    else void this.router.navigate(['/projects'], { replaceUrl: true });
  }

  protected openProject(projectId: ProjectId): void {
    void this.router.navigate(['/projects', projectId]);
  }

  protected async openSessionOf(session: SessionSummary): Promise<void> {
    await this.router.navigate(['/projects', session.projectId, 'sessions', session.sessionId]);
  }

  /** "Nueva sesión": starts a session in the project, which opens in the chat at its own route. */
  protected async newSession(): Promise<void> {
    if (this.creating()) return;
    this.creating.set(true);
    const started = await this.state.createSession();
    this.creating.set(false);
    if (started !== undefined) await this.openSessionOf(started);
  }

  protected async created(project: Project): Promise<void> {
    this.dialogOpen.set(false);
    await this.state.refresh();
    await this.router.navigate(['/projects', project.projectId]);
  }

  protected async removeSelected(): Promise<void> {
    const projectId = this.state.selectedId();
    if (projectId === undefined) return;
    if (await this.state.remove(projectId)) await this.router.navigate(['/projects'], { replaceUrl: true });
  }
}
