import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import type { Provider } from '../../../shared/settings/settings.model';
import { I18n } from '../../core/i18n';
import { ButtonComponent } from '../../shared/ui/button/button';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { StateComponent } from '../../shared/ui/state/state';
import { TagComponent } from '../../shared/ui/tag/tag';
import { TreeViewComponent } from '../../shared/ui/tree-view/tree-view';
import { sampleFiles } from './files-sample';
import { NewTerminal } from './new-terminal';
import { ProjectsState } from './projects-state';
import { terminalsOf, type TerminalEntry, type TerminalId } from './terminal-entries';
import { SAMPLE_EXIT_CODE } from './terminal-sample';
import { shortPath, terminalBadge } from './terminal-view';
import { TerminalsState } from './terminals-state';

/** The selected project: who it is, its Terminals and its files. */
@Component({
  selector: 'app-project-content',
  imports: [ButtonComponent, ListRow, NewTerminal, StateComponent, TagComponent, TreeViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './project-content.html',
  styleUrl: './project-content.css',
})
export class ProjectContent {
  protected readonly state = inject(ProjectsState);
  protected readonly i18n = inject(I18n);
  protected readonly terminalBadge = terminalBadge;
  private readonly terminalsState = inject(TerminalsState);

  /** The project's folder is not on disk: only the header and an Archivos that says so are shown. */
  readonly folderMissing = input(false);
  /** The terminal of the route. */
  readonly openTerminalId = input<TerminalId>();
  readonly terminalOpened = output<TerminalEntry>();
  /** "Nueva terminal" was pressed: the screen creates it and opens it. */
  readonly newTerminal = output<Provider | undefined>();
  readonly removed = output<void>();

  /** Archivos is a static placeholder for now (see files-sample.ts); it changes only with the language. */
  protected readonly files = computed(() => sampleFiles(this.i18n.t('files.modified')));
  protected readonly filesOpen = signal(true);

  protected readonly project = this.state.selected;
  protected readonly terminals = computed(() => {
    const selected = this.project();
    return selected === undefined ? [] : terminalsOf(this.terminalsState.entries(), selected.projectId);
  });

  /** A folded Terminals group keeps its header, its count and its "new" button. */
  protected readonly terminalsFolded = signal(false);

  /** A failed terminal says how it ended; the others, where they are. */
  protected terminalMeta(terminal: TerminalEntry): string {
    return terminal.state === 'Error'
      ? this.i18n.t('terminals.exited', { code: SAMPLE_EXIT_CODE })
      : shortPath(this.project()?.cwd ?? '');
  }
}
