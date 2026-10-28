import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonComponent } from '../button/button';
import { ChipComponent } from '../chip/chip';
import { ListGroupLabel } from '../list-row/list-group-label';
import { ListRow } from '../list-row/list-row';
import { SwitcherComponent } from '../switcher/switcher';
import { SwitcherOption } from '../switcher/switcher.types';
import { TagComponent } from '../tag/tag';

export interface HistoryItem {
  readonly id: string;
  readonly title: string;
  /** Mono line: branch / changes. */
  readonly sub?: string;
  readonly time: string;
  /** Tag text, e.g. "merged" or "finished". */
  readonly status?: string;
  readonly last?: string;
}

export interface HistoryGroup {
  readonly label: string;
  readonly items: readonly HistoryItem[];
}

export interface HistoryFilter {
  readonly id: string;
  readonly label: string;
}

const DEFAULT_VIEWS: SwitcherOption<unknown>[] = [
  { value: 'all', label: 'All' },
  { value: 'repo', label: 'This repo' },
  { value: 'unfinished', label: 'Unfinished' },
];

@Component({
  selector: 'ui-history',
  imports: [
    ButtonComponent,
    ChipComponent,
    FormsModule,
    ListGroupLabel,
    ListRow,
    SwitcherComponent,
    TagComponent,
  ],
  templateUrl: './history.html',
  styleUrl: './history.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryComponent {
  readonly groups = input.required<readonly HistoryGroup[]>();
  readonly selectedId = input<string | null>(null);
  readonly query = input('');
  readonly filters = input<readonly HistoryFilter[]>([]);
  readonly views = input<SwitcherOption<unknown>[]>(DEFAULT_VIEWS);
  readonly view = input<unknown>('all');

  readonly select = output<string>();
  readonly resume = output<string>();
  readonly transcript = output<string>();
  readonly queryChange = output<string>();
  readonly viewChange = output<unknown>();
  readonly filterRemove = output<string>();
  readonly clearSearch = output<void>();

  protected readonly empty = computed(() => this.groups().every((g) => g.items.length === 0));

  protected onQuery(event: Event): void {
    this.queryChange.emit((event.target as HTMLInputElement).value);
  }
}
