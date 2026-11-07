import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, untracked } from '@angular/core';
import { Router } from '@angular/router';
import type { Project } from '../../../shared/projects/projects.model';
import { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { I18n } from '../../core/i18n';
import { shortcutKeys } from '../../core/shortcuts';
import { ButtonComponent } from '../../shared/ui/button/button';
import { NewTerminal } from './new-terminal';
import { ProjectsState } from './projects-state';
import { TabBar } from './tab-bar';
import { neighbourOf, tabPath, type Tab } from './tabs';
import { TabsState } from './tabs-state';
import type { TerminalEntry } from './terminal-entries';
import { TerminalScreen } from './terminal-screen';
import { TerminalsState } from './terminals-state';
import { WorkspaceHero } from './workspace-hero';
import { entryPath, entryTarget } from './workspace-entry';

/**
 * Projects: the selected Project's Tab bar and the Tab on screen (the list is in the sidebar). One component serves
 * `/projects`, `/projects/:projectId` and `/projects/:projectId/terminals/:terminalId` (see `workspace.routes`),
 * so moving between them keeps the columns in place. The route decides what is open; this screen makes the
 * state follow it.
 */
@Component({
  selector: 'app-projects-screen',
  imports: [ButtonComponent, NewTerminal, TabBar, TerminalScreen, WorkspaceHero],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './projects-screen.html',
  styleUrl: './projects-screen.css',
})
export class ProjectsScreen {
  protected readonly i18n = inject(I18n);
  protected readonly state = inject(ProjectsState);
  private readonly router = inject(Router);
  private readonly terminals = inject(TerminalsState);
  private readonly tabsState = inject(TabsState);

  /** Path parameters of the route, bound to inputs. */
  readonly projectId = input<string>();
  readonly terminalId = input<string>();

  /** The terminal of the route, if it is one of the selected project's. Terminals live only as long as the app run. */
  protected readonly routeTerminal = computed((): TerminalEntry | undefined => {
    const id = this.terminalId();
    const entry = id === undefined ? undefined : this.terminals.find(id);
    return entry !== undefined && entry.projectId === this.state.selectedId() ? entry : undefined;
  });

  /** The selected project's Tabs, to tell "no Tab yet" from "pick one". */
  protected readonly tabs = computed(() => {
    const selected = this.state.selectedId();
    return selected === undefined ? [] : this.tabsState.tabsOf(selected);
  });

  protected readonly newTabKeys = shortcutKeys('newTab');
  protected readonly listReady = computed(() => this.state.projects().status === 'ready');
  protected readonly hasProjects = computed(() => this.state.all().length > 0);
  protected readonly folderMissing = computed(() => this.state.selected() !== undefined && this.state.folder() === 'Missing');

  constructor() {
    void this.state.refresh();

    // The route says what is open; the state follows it once the list is known.
    effect(() => {
      const list = this.state.projects();
      const id = this.projectId();
      if (list.status !== 'ready') return;
      untracked(() => this.follow(list.items, id));
    });

    // The Terminal on screen is the current one, which is also what the Panel shows.
    effect(() => {
      const terminal = this.routeTerminal();
      if (terminal !== undefined) untracked(() => this.terminals.setCurrent(terminal.id));
    });

    // A terminal that does not exist (a stale route) sends the user back to the project.
    effect(() => {
      const id = this.terminalId();
      const selected = this.state.selectedId();
      if (id === undefined || selected === undefined || selected !== this.projectId() || this.routeTerminal() !== undefined) return;
      untracked(() => void this.router.navigate(['/projects', selected], { replaceUrl: true }));
    });

    // The folder may come back, or go away, while the app is in the background.
    const onFocus = () => this.state.recheckFolder();
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => window.removeEventListener('focus', onFocus));
  }

  /** Aligns the selection with the route; `/projects` alone goes where entering the Workspace should. */
  private follow(projects: ReadonlyArray<Project>, id: string | undefined): void {
    if (id === undefined) {
      const target = entryTarget(projects);
      if (target === undefined) this.state.deselect();
      else void this.router.navigate(entryPath(target), { replaceUrl: true });
      return;
    }
    const projectId = ProjectId.make(id);
    if (projects.some((project) => project.projectId === projectId)) this.state.select(projectId);
    else void this.router.navigate(['/projects'], { replaceUrl: true });
  }

  protected async openTerminal(terminal: TerminalEntry): Promise<void> {
    await this.router.navigate(['/projects', terminal.projectId, 'terminals', terminal.id]);
  }

  /** A Tab shows its first Terminal: until Panes land, it is the only one. */
  protected async openTab(tab: Tab): Promise<void> {
    await this.router.navigate(tabPath(tab));
  }

  /**
   * Closes a Tab and its Terminals. The Tab on screen is left first, for its neighbour or the project, so the route never
   * names a Terminal that is gone (which would send it back to the project instead).
   */
  protected async closeTab(tab: Tab): Promise<void> {
    const projectId = this.state.selectedId();
    if (projectId !== undefined && tab.id === this.routeTerminal()?.tabId) {
      const neighbour = neighbourOf(this.tabs(), tab.id);
      await this.router.navigate(neighbour === undefined ? ['/projects', projectId] : tabPath(neighbour), { replaceUrl: true });
    }
    await this.tabsState.close(tab);
  }

  /** "Nueva terminal", or New Tab: opens a Terminal in a new Tab of the project (a local entry if main cannot start one) and shows it at its own route. */
  protected async newTerminal(provider?: Provider): Promise<void> {
    const project = this.state.selected();
    if (project === undefined) return;
    const terminal = (await this.terminals.createLive(project.projectId, project.cwd, provider)) ?? this.terminals.create(project.projectId);
    await this.openTerminal(terminal);
  }

  protected async removeSelected(): Promise<void> {
    const projectId = this.state.selectedId();
    if (projectId === undefined) return;
    if (await this.state.remove(projectId)) await this.router.navigate(['/projects'], { replaceUrl: true });
  }
}
