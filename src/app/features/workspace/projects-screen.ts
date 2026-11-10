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
import { PaneGrid } from './pane-grid';
import { bringForward, panesOf } from './pane-layout';
import { neighbourOf, tabPath, terminalPath, type Tab, type TabId } from './tabs';
import { TabsState } from './tabs-state';
import type { TerminalEntry, TerminalId } from './terminal-entries';
import { TerminalsState } from './terminals-state';
import { terminalOf, terminalView } from './views';
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
  imports: [ButtonComponent, NewTerminal, PaneGrid, TabBar, WorkspaceHero],
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

  /** The Tab on screen: the route Terminal's. */
  protected readonly routeTab = computed(() => {
    const terminal = this.routeTerminal();
    return terminal === undefined ? undefined : this.tabs().find((tab) => tab.id === terminal.tabId);
  });

  /** The route by ids only, so what follows it does not rerun on every change of a Terminal's state. */
  private readonly routeIds = computed(
    () => {
      const terminal = this.routeTerminal();
      return terminal === undefined ? undefined : { terminal: terminal.id, tab: terminal.tabId };
    },
    { equal: (a, b) => a?.terminal === b?.terminal && a?.tab === b?.tab },
  );

  /** What the Tab on screen has in front: its focused Pane's expanded View. */
  private readonly front = computed(
    () => {
      const tab = this.routeTab();
      const layout = tab === undefined ? undefined : this.tabsState.layoutOf(tab);
      const expanded = layout === undefined ? undefined : panesOf(layout).find((pane) => pane.id === layout.focused)?.expanded;
      // The route names a Terminal, so only a Terminal's View is followed.
      const view = expanded === undefined ? undefined : terminalOf(expanded);
      return tab === undefined || view === undefined ? undefined : { tab: tab.id, view };
    },
    { equal: (a, b) => a?.tab === b?.tab && a?.view === b?.view },
  );

  /** The last Tab the route was on: when its Terminal goes (closed, restarted), the route stays in that Tab if it can. */
  private lastTabId: TabId | undefined;

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

    // The route is the focused Pane's expanded View: a route to another Terminal of the Tab (the sidebar, a Tab, the
    // Panel) brings its Pane into focus and its View to the front of its Stack.
    effect(() => {
      const ids = this.routeIds();
      if (ids === undefined) return;
      this.lastTabId = ids.tab;
      untracked(() => {
        this.tabsState.visit(ids.tab);
        const tab = this.routeTab();
        const layout = tab === undefined ? undefined : this.tabsState.layoutOf(tab);
        if (tab === undefined || layout === undefined || this.front()?.view === ids.terminal) return;
        this.tabsState.update(tab, (current) => bringForward(current, terminalView(ids.terminal)));
      });
    });

    // And the other way: when the user focuses another Pane or View, or a split opens a Terminal, the route follows.
    // A File View in front leaves the route on the Terminal it was on (the route names a Terminal).
    let previous: { readonly tab: TabId; readonly view: TerminalId } | undefined;
    effect(() => {
      const front = this.front();
      if (front === undefined && this.routeTab() !== undefined) return;
      const before = previous;
      previous = front;
      if (front === undefined || before === undefined || before.tab !== front.tab || before.view === front.view) return;
      untracked(() => {
        const projectId = this.state.selectedId();
        if (projectId !== undefined && front.view !== this.terminalId()) {
          void this.router.navigate(['/projects', projectId, 'terminals', front.view], { replaceUrl: true });
        }
      });
    });

    // A terminal that does not exist (a stale route, a closed or restarted Terminal) goes to what its Tab has in front
    // now, or back to the project when the Tab is gone.
    effect(() => {
      const id = this.terminalId();
      const selected = this.state.selectedId();
      if (id === undefined || selected === undefined || selected !== this.projectId() || this.routeTerminal() !== undefined) return;
      untracked(() => {
        const tab = this.tabs().find((candidate) => candidate.id === this.lastTabId);
        void this.router.navigate(tab === undefined ? ['/projects', selected] : tabPath(tab, this.tabsState.layoutOf(tab)), { replaceUrl: true });
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
    await this.router.navigate(terminalPath(terminal));
  }

  /** A Tab opens as it was left: at its focused Pane's expanded View. */
  protected async openTab(tab: Tab): Promise<void> {
    await this.router.navigate(tabPath(tab, this.tabsState.layoutOf(tab)));
  }

  /**
   * Closes a Tab and its Terminals. The Tab on screen is left first, for its neighbour or the project, so the route never
   * names a Terminal that is gone (which would send it back to the project instead).
   */
  protected async closeTab(tab: Tab): Promise<void> {
    const projectId = this.state.selectedId();
    if (projectId !== undefined && tab.id === this.routeTerminal()?.tabId) {
      const neighbour = neighbourOf(this.tabs(), tab.id);
      await this.router.navigate(neighbour === undefined ? ['/projects', projectId] : tabPath(neighbour, this.tabsState.layoutOf(neighbour)), { replaceUrl: true });
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
    if (!(await this.state.remove(projectId))) return;
    await this.router.navigate(['/projects'], { replaceUrl: true });
    await this.tabsState.closeProject(projectId);
  }
}
