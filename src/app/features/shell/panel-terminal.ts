import { ChangeDetectionStrategy, Component, computed, inject, output, signal } from '@angular/core';
import type { Provider } from '../../../shared/settings/settings.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { I18n } from '../../core/i18n';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ChipStripComponent, type ChipStripItem } from '../../shared/ui/chip-strip/chip-strip';
import { NewTerminal } from '../workspace/new-terminal';
import { ProjectsState } from '../workspace/projects-state';
import { TerminalScreen } from '../workspace/terminal-screen';
import { TerminalsState } from '../workspace/terminals-state';
import { WorkspaceHero } from '../workspace/workspace-hero';
import { panelProject } from './panel-project';

/**
 * What the Panel shows: the current Terminal, rendered by the same screen as the Workspace, and a strip to switch
 * between the Terminals there are. With none, an empty state that opens one in the Project used last.
 */
@Component({
  selector: 'app-panel-terminal',
  imports: [ButtonComponent, ChipStripComponent, NewTerminal, TerminalScreen, WorkspaceHero],
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

  /** One chip per Terminal; with Terminals of several Projects the chip also names its Project, since "Terminal 1" repeats. */
  protected readonly items = computed((): ReadonlyArray<ChipStripItem> => {
    const entries = this.terminals.entries();
    const several = new Set(entries.map((entry) => entry.projectId)).size > 1;
    return entries.map((entry) => {
      const name = this.i18n.t('terminals.name', { number: entry.number });
      const project = several ? this.projects.all().find((candidate) => candidate.projectId === entry.projectId)?.name : undefined;
      const status = entry.state === 'Live' ? 'live' : entry.state === 'Done' ? 'done' : undefined;
      return { id: entry.id, label: project === undefined ? name : `${project} · ${name}`, status };
    });
  });

  constructor() {
    // The Panel can be the first thing on screen, before the Workspace ever loaded the list.
    if (this.projects.projects().status !== 'ready') void this.projects.refresh();
  }

  protected select(id: string): void {
    this.terminals.setCurrent(TerminalId.make(id));
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
