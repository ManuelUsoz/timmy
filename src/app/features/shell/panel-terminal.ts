import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import type { Provider } from '../../../shared/settings/settings.model';
import { I18n } from '../../core/i18n';
import { ButtonComponent } from '../../shared/ui/button/button';
import { NewTerminal } from '../workspace/new-terminal';
import { ProjectsState } from '../workspace/projects-state';
import { TerminalScreen } from '../workspace/terminal-screen';
import { TerminalsState } from '../workspace/terminals-state';
import { WorkspaceHero } from '../workspace/workspace-hero';
import { PanelRail } from './panel-rail';
import { panelProject } from './panel-project';

/**
 * What the Panel shows: a rail with the Mascot and every Terminal, and beside it the current Terminal, rendered by the
 * same screen as the Workspace. With none, an empty state that opens one in the Project used last. Whatever the Panel's
 * host puts in `[panelControls]` goes at the foot of the rail.
 */
@Component({
  selector: 'app-panel-terminal',
  imports: [ButtonComponent, NewTerminal, PanelRail, TerminalScreen, WorkspaceHero],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './panel-terminal.html',
  styleUrl: './panel-terminal.css',
})
export class PanelTerminal {
  protected readonly i18n = inject(I18n);
  private readonly terminals = inject(TerminalsState);
  private readonly projects = inject(ProjectsState);

  /** The empty state has nowhere to open a Terminal until a Project exists; this takes the user to the Workspace to add one. */
  readonly openWorkspace = output<void>();
  /** The user asked for the Pill from the Mascot. */
  readonly collapse = output<void>();

  protected readonly current = this.terminals.current;
  protected readonly projectsReady = computed(() => this.projects.projects().status === 'ready');
  protected readonly home = computed(() => panelProject(this.projects.all()));
  protected readonly opening = signal(false);
  protected readonly failed = signal(false);

  /** The folder of the current Terminal's Project, for its header and for Restart. Empty until the list of Projects is known. */
  protected readonly cwd = computed(() => {
    const projectId = this.current()?.projectId;
    return this.projects.all().find((project) => project.projectId === projectId)?.cwd ?? '';
  });

  constructor() {
    // The Panel can be the first thing on screen, before the Workspace ever loaded the list.
    if (this.projects.projects().status !== 'ready') void this.projects.refresh();
  }

  protected async open(provider?: Provider): Promise<void> {
    const project = this.home();
    if (project === undefined || this.opening()) return;
    this.opening.set(true);
    this.failed.set(false);
    const terminal = await this.terminals.createLive(project.projectId, project.cwd, provider);
    this.failed.set(terminal === undefined);
    this.opening.set(false);
  }
}
