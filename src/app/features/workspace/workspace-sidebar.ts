import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import type { TerminalStatus } from '../../../shared/notification/notification.model';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { I18n } from '../../core/i18n';
import type { MessageKey } from '../../core/i18n-dictionaries';
import { ListGroupLabel } from '../../shared/ui/list-row/list-group-label';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { statusTone } from '../../shared/ui/mascot/mascot';
import { ProviderIconComponent, type Provider as ProviderMark } from '../../shared/ui/provider-icon/provider-icon';
import { StateComponent, type StateTone } from '../../shared/ui/state/state';
import { NotificationsState } from '../shell/notifications-state';
import { railView, type RailRow } from '../shell/panel-rail-view';
import { mostUrgent } from '../shell/pill-view';
import { ProjectList } from './project-list';
import { ProjectsState } from './projects-state';
import { TerminalsState } from './terminals-state';
import { WorkspaceLayoutState } from './workspace-layout';
import { projectTallies } from './workspace-sidebar-view';

/** The Terminal status names (GLOSSARY), as translation keys. */
const STATUS_KEY = {
  Working: 'state.working',
  Waiting: 'state.waiting',
  Done: 'state.done',
  Error: 'state.error',
  Idle: 'state.idle',
} as const satisfies Record<TerminalStatus, MessageKey>;

/** The mark each Provider is drawn with. */
const PROVIDER_MARK: Readonly<Record<Provider, ProviderMark>> = {
  ClaudeCode: 'claude',
  Codex: 'openai',
  OpenCode: 'opencode',
};

/**
 * The Workspace's sidebar: the Projects, every Terminal across them (ordered and grouped as in the Panel's rail) and
 * Settings. Ctrl+B (see `WorkspaceComponent`) or its own button collapses it to a 48 px strip.
 */
@Component({
  selector: 'app-workspace-sidebar',
  imports: [ListGroupLabel, ListRow, ProjectList, ProviderIconComponent, RouterLink, RouterLinkActive, StateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './workspace-sidebar.html',
  styleUrl: './workspace-sidebar.css',
  host: {
    role: 'complementary',
    '[attr.aria-label]': "i18n.t('sidebar.label')",
    '[class.collapsed]': 'collapsed()',
  },
})
export class WorkspaceSidebar {
  protected readonly i18n = inject(I18n);
  protected readonly layout = inject(WorkspaceLayoutState);
  private readonly projects = inject(ProjectsState);
  private readonly terminals = inject(TerminalsState);
  private readonly notifications = inject(NotificationsState);
  private readonly router = inject(Router);

  protected readonly collapsed = computed(() => this.layout.layout().sidebar === 'collapsed');

  private readonly view = computed(() => railView(this.terminals.entries(), this.notifications.notifications(), this.projects.all()));
  protected readonly groups = computed(() => this.view().groups);
  protected readonly tallies = computed(() => projectTallies(this.view()));
  protected readonly terminalCount = computed(() => this.terminals.entries().length);
  /** The most urgent status among all Terminals, which the collapsed strip shows on its Terminals button. */
  protected readonly urgent = computed(() => mostUrgent(this.groups().flatMap((group) => group.rows.map((row) => row.status))));

  /** The URL, to tell which Terminal is on screen. */
  private readonly url = signal(this.router.url);

  constructor() {
    const subscription = this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) this.url.set(event.urlAfterRedirects);
    });
    inject(DestroyRef).onDestroy(() => subscription.unsubscribe());
  }

  protected isOpen(row: RailRow): boolean {
    return this.url().endsWith(`/terminals/${row.id}`);
  }

  protected tone(status: TerminalStatus): StateTone {
    return statusTone[status];
  }

  protected word(status: TerminalStatus): string {
    return this.i18n.t(STATUS_KEY[status]);
  }

  protected mark(provider: Provider): ProviderMark {
    return PROVIDER_MARK[provider];
  }

  protected openProject(projectId: ProjectId): void {
    void this.router.navigate(['/projects', projectId]);
  }

  protected openTerminal(row: RailRow): void {
    void this.router.navigate(['/projects', row.projectId, 'terminals', row.id]);
  }

  protected newProject(): void {
    this.projects.creating.set(true);
  }
}
