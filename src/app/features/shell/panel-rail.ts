import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import type { TerminalStatus } from '../../../shared/notification/notification.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { I18n } from '../../core/i18n';
import { providerNames } from '../../core/provider-settings';
import { ListGroupLabel } from '../../shared/ui/list-row/list-group-label';
import { ListRow } from '../../shared/ui/list-row/list-row';
import { MascotComponent, statusTone } from '../../shared/ui/mascot/mascot';
import { StateComponent, type StateTone } from '../../shared/ui/state/state';
import { NewTerminal } from '../workspace/new-terminal';
import { ProjectsState } from '../workspace/projects-state';
import { TerminalsState } from '../workspace/terminals-state';
import { NotificationsState } from './notifications-state';
import { railView, urgentTerminal, type RailRow } from './panel-rail-view';
import { pillView, statusWordKey } from './pill-view';

/** The tally line of each status that says something, as a translation key. */
const TALLY_KEY = {
  Waiting: 'panel.tallyWaiting',
  Error: 'panel.tallyError',
  Working: 'panel.tallyWorking',
  Done: 'panel.tallyDone',
} as const;

/** The statuses that have a word beside their line: Idle and running say it with the dot alone. */
const SAYS_WORD: ReadonlyArray<TerminalStatus> = ['Waiting', 'Error', 'Done'];

/**
 * The rail of the Panel: the Mascot with how many Terminals are in each status, then every Terminal as a line, those
 * that need the user first. The Panel's own controls (mode switcher, close) are projected after "New terminal".
 */
@Component({
  selector: 'app-panel-rail',
  imports: [ListGroupLabel, ListRow, MascotComponent, NewTerminal, StateComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './panel-rail.html',
  styleUrl: './panel-rail.css',
})
export class PanelRail {
  protected readonly i18n = inject(I18n);
  private readonly terminals = inject(TerminalsState);
  private readonly projects = inject(ProjectsState);
  private readonly notifications = inject(NotificationsState);

  /** Whether to offer "New terminal": there is a Project to open one in, and the empty state is not offering it already. */
  readonly canOpen = input(true);
  /** A Terminal is being opened already. */
  readonly busy = input(false);
  readonly opened = output<Provider | undefined>();
  /** A double-click on the Mascot: back to the Pill, as a double-click on the Pill goes to the Panel. */
  readonly collapse = output<void>();

  protected readonly mascot = computed(() => pillView(this.notifications.notifications()).status);
  private readonly view = computed(() => railView(this.terminals.entries(), this.notifications.notifications(), this.projects.all()));
  protected readonly groups = computed(() => this.view().groups);
  protected readonly urgent = computed(() => urgentTerminal(this.view(), this.mascot()));
  protected readonly currentId = computed(() => this.terminals.current()?.id);

  protected readonly tally = computed(() =>
    this.view().tally.map(({ status, count }) => ({
      status,
      tone: statusTone[status],
      text: this.i18n.t(TALLY_KEY[status as keyof typeof TALLY_KEY], { count }),
    })),
  );
  /** What the Mascot says, in words, for a screen reader. */
  protected readonly summary = computed(() => {
    const lines = this.tally().map((line) => line.text);
    return lines.length === 0 ? this.i18n.t('pill.idle') : lines.join(', ');
  });

  protected tone(status: TerminalStatus): StateTone {
    return statusTone[status];
  }

  protected word(status: TerminalStatus): string | undefined {
    return SAYS_WORD.includes(status) ? this.i18n.t(statusWordKey[status]) : undefined;
  }

  /** Under a Project the line says what runs in the Terminal; among those that need the user, which Project it is in. */
  protected sub(row: RailRow, needsYou: boolean): string {
    if (needsYou) return row.projectName;
    return row.provider === undefined ? this.i18n.t('terminals.shell') : providerNames[row.provider];
  }

  protected select(row: RailRow): void {
    this.terminals.setCurrent(row.id);
  }

  protected showUrgent(): void {
    const id = this.urgent();
    if (id !== undefined) this.terminals.setCurrent(id);
  }
}
