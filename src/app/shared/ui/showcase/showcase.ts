import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ChipComponent } from '../chip/chip';
import { TagComponent } from '../tag/tag';
import { StateComponent } from '../state/state';
import { CheckboxComponent } from '../checkbox/checkbox';
import { AvatarComponent } from '../avatar/avatar';
import { LogoComponent } from '../logo/logo';
import { MenuComponent } from '../menu/menu';
import { OptionComponent } from '../menu/option';
import { OptionGroupComponent } from '../menu/option-group';
import { JsonPipe } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { ButtonComponent } from '../button/button';
import { SelectComponent } from '../select/select';
import { SelectGroup, SelectOption } from '../select/select.types';
import { SwitcherComponent } from '../switcher/switcher';
import { TextInputComponent } from '../text-input/text-input';
import { AutocompleteComponent } from '../autocomplete/autocomplete';
import { AutocompleteOption } from '../autocomplete/autocomplete.types';
import { TreeViewComponent } from '../tree-view/tree-view';
import { TreeNode } from '../tree-view/tree-view.types';
import { ListRow } from '../list-row/list-row';
import { ListGroupLabel } from '../list-row/list-group-label';
import { PillComponent } from '../pill/pill';
import { PillStackComponent } from '../pill/pill-stack';
import { HistoryComponent, HistoryFilter, HistoryGroup } from '../history/history';
import { SessionComponent } from '../session/session';
import { AskRowComponent } from '../ask-row/ask-row';
import { MessageComponent } from '../message/message';
import { ChipStripComponent, ChipStripItem } from '../chip-strip/chip-strip';
import type { PermissionRequest } from '../../../../shared/chat/permission.model';
import type { AgentId, OptionId, PermissionRequestId, ToolCallId } from '../../../../shared/chat/ids.model';

@Component({
  selector: 'ui-showcase',
  imports: [
    ButtonComponent,
    SelectComponent,
    ReactiveFormsModule,
    JsonPipe,
    ChipComponent,
    TagComponent,
    StateComponent,
    CheckboxComponent,
    AvatarComponent,
    LogoComponent,
    MenuComponent,
    OptionComponent,
    OptionGroupComponent,
    SwitcherComponent,
    TextInputComponent,
    AutocompleteComponent,
    TreeViewComponent,
    ListRow,
    ListGroupLabel,
    PillComponent,
    PillStackComponent,
    HistoryComponent,
    SessionComponent,
    AskRowComponent,
    MessageComponent,
    ChipStripComponent,
  ],
  templateUrl: './showcase.html',
  styleUrl: './showcase.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ShowcaseComponent {
  protected readonly kinds = ['primary', 'secondary', 'tertiary', 'ghost', 'danger'] as const;
  protected readonly sizes = ['sm', 'md', 'lg'] as const;

  protected readonly options: SelectOption<string>[] = [
    { value: 'opus', label: 'Claude Opus' },
    { value: 'sonnet', label: 'Claude Sonnet' },
    { value: 'haiku', label: 'Claude Haiku' },
    { value: 'legacy', label: 'Legacy model', disabled: true },
  ];

  protected readonly groups: SelectGroup<string>[] = [
    {
      label: 'Anthropic',
      options: [
        { value: 'opus', label: 'Claude Opus' },
        { value: 'sonnet', label: 'Claude Sonnet' },
      ],
    },
    {
      label: 'Local',
      options: [
        { value: 'llama', label: 'Llama' },
        { value: 'qwen', label: 'Qwen', disabled: true },
      ],
    },
  ];

  protected readonly single = new FormControl<string | null>('sonnet');
  protected readonly multiCount = new FormControl<string[]>(['opus', 'haiku']);
  protected readonly multiChips = new FormControl<string[]>(['opus', 'sonnet']);
  protected readonly grouped = new FormControl<string | null>(null);
  protected readonly sm = new FormControl<string | null>(null);
  protected readonly md = new FormControl<string | null>(null);
  protected readonly lg = new FormControl<string | null>(null);
  protected readonly withError = new FormControl<string | null>(null);
  protected readonly disabledCtl = new FormControl<string | null>({ value: 'haiku', disabled: true });

  protected readonly switchTwo = [
    { value: 'chat', label: 'Chat' },
    { value: 'code', label: 'Code' },
  ];
  protected readonly switchThree = [
    { value: 'day', label: 'Day' },
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ];
  protected readonly switchDefault = new FormControl<string | null>('chat');
  protected readonly switchThreeCtl = new FormControl<string | null>('week');
  protected readonly switchSm = new FormControl<string | null>('day');
  protected readonly switchFull = new FormControl<string | null>('month');

  protected readonly textDefault = new FormControl<string>('', { nonNullable: true });
  protected readonly textError = new FormControl<string>('abc', { nonNullable: true });
  protected readonly textDisabled = new FormControl<string>(
    { value: 'Locked', disabled: true },
    { nonNullable: true },
  );

  protected readonly acOptions: AutocompleteOption<string>[] = [
    { value: 'main', label: 'main', group: 'Branches' },
    { value: 'feature-chat', label: 'feature/chat', group: 'Branches' },
    { value: 'fix-menu', label: 'fix/menu', group: 'Branches' },
    { value: 'readme', label: 'README.md', group: 'Files' },
    { value: 'package', label: 'package.json', group: 'Files' },
  ];
  protected readonly acFlat = this.acOptions.map(({ value, label }) => ({ value, label }));
  protected readonly acSingle = new FormControl<string | null>(null);
  protected readonly acMulti = new FormControl<string[]>(['main']);
  protected readonly acSearch = new FormControl<string | null>(null);
  protected readonly acLoading = new FormControl<string | null>(null);

  protected readonly treeNodes: TreeNode[] = [
    {
      id: 'src',
      label: 'src',
      children: [
        {
          id: 'app',
          label: 'app',
          children: [
            { id: 'app.ts', label: 'app.ts' },
            { id: 'app.html', label: 'app.html' },
          ],
        },
        { id: 'main.ts', label: 'main.ts' },
      ],
    },
    { id: 'package.json', label: 'package.json' },
    { id: 'locked', label: 'locked.txt', disabled: true },
  ];
  protected readonly activityNodes: TreeNode[] = [
    { id: 'read', label: 'Read', status: 'done', meta: '×4' },
    { id: 'edit', label: 'Edit', status: 'running', meta: 'hook-server.ts' },
    {
      id: 'explore',
      label: 'Explore',
      expanded: true,
      badge: { label: 'Live', tone: 'success' },
      meta: '0:18',
      children: [
        { id: 'grep', label: 'Grep', status: 'done', meta: 'announce' },
        { id: 'read2', label: 'Read', status: 'running', meta: 'pipe.ts' },
      ],
    },
    {
      id: 'plan',
      label: 'Plan',
      badge: { label: 'Done' },
      meta: '5 tools',
      children: [{ id: 'glob', label: 'Glob', status: 'done', meta: 'src/**' }],
    },
  ];
  protected readonly stripSelected = signal<string | null>('reply-bubble');
  protected readonly stripItems: ChipStripItem[] = [
    { id: 'reply-bubble', label: 'reply-bubble', status: 'live' },
    { id: 'feat/voice', label: 'feat/voice', branch: true, status: 'live' },
    { id: 'fix/i18n', label: 'fix/i18n', branch: true, status: 'done' },
  ];
  protected readonly stripOthers: ChipStripItem[] = [
    { id: 'api-gateway', label: 'api-gateway', status: 'asks' },
    { id: 'perf/cache', label: 'perf/cache', branch: true, status: 'live', outline: true },
    { id: 'docs-site', label: 'docs-site', status: 'done', outline: true },
  ];
  protected readonly treeSingle =new FormControl<string | null>('main.ts');
  protected readonly treeChecked = new FormControl<string[]>(['app.ts']);

  protected readonly pillTones = ['neutral', 'running', 'waiting', 'error', 'done'] as const;
  protected readonly rowSelected = signal('b');
  protected readonly historySelected = signal<string | null>('h2');
  protected readonly historyGroups: HistoryGroup[] = [
    {
      label: 'Today',
      items: [
        { id: 'h1', title: 'Fix menu focus', sub: 'fix/menu', time: '10:42', status: 'merged', last: 'Done.' },
        { id: 'h2', title: 'Add chat history', sub: 'feature/chat', time: '09:15', status: 'finished' },
      ],
    },
    { label: 'Yesterday', items: [{ id: 'h3', title: 'Tailwind setup', sub: 'main', time: '17:03' }] },
  ];
  protected readonly historyFilters: HistoryFilter[] = [{ id: 'repo', label: 'timmy' }];
  protected readonly historyEmpty: HistoryGroup[] = [];
  protected readonly sessionTools: TreeNode[] = [
    {
      id: 'agent',
      label: 'Explore',
      children: [
        { id: 't1', label: 'Read src/app/app.ts' },
        { id: 't2', label: 'Grep "permission"' },
      ],
    },
    { id: 't3', label: 'Edit src/app/app.html' },
  ];
  protected readonly samplePermission: PermissionRequest = {
    id: 'req-1' as PermissionRequestId,
    agentId: 'main' as AgentId,
    toolCall: {
      id: 'call-1' as ToolCallId,
      agentId: 'main' as AgentId,
      name: 'Bash',
      kind: 'Execute',
      title: 'npm run build',
      status: 'Pending',
      locations: [],
      diffs: [],
    },
    options: [
      { id: 'o1' as OptionId, label: 'Allow once', kind: 'AllowOnce' },
      { id: 'o2' as OptionId, label: 'Always allow', kind: 'AllowAlways' },
      { id: 'o3' as OptionId, label: 'Deny', kind: 'RejectOnce' },
    ],
  };

  protected readonly chipTones =['blue', 'green', 'red', 'purple', 'outline', 'mono'] as const;
  protected readonly tagTones = ['green', 'blue', 'red', 'purple', 'gray'] as const;
  protected readonly stateTones = ['success', 'info', 'warning', 'error', 'merged', 'idle'] as const;
  protected readonly removable = signal(['alpha', 'beta', 'gamma']);
  protected readonly accepted = new FormControl<boolean>(true);
  protected readonly menuSelected = signal<unknown>('sonnet');
  protected readonly menuMulti = signal<unknown[]>(['opus']);

  protected remove(item: string): void {
    this.removable.update((l) => l.filter((x) => x !== item));
  }

  protected toggleMulti(v: unknown): void {
    this.menuMulti.update((l) => (l.includes(v) ? l.filter((x) => x !== v) : [...l, v]));
  }

  protected toggleDisabled(): void {
    if (this.disabledCtl.disabled) this.disabledCtl.enable();
    else this.disabledCtl.disable();
  }
}
