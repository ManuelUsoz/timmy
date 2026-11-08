import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { I18n } from '../../core/i18n';
import type { MessageKey } from '../../core/i18n-dictionaries';
import { ModalComponent } from '../../shared/ui/modal/modal';
import { TooltipComponent } from '../../shared/ui/tooltip/tooltip';
import { FilesBrowser } from './files-browser';
import { NewTerminal } from './new-terminal';
import { closeNeedsConfirm, tabDot, type Tab, type TabId } from './tabs';
import { shortcutKeys } from '../../core/shortcuts';
import { TabsState } from './tabs-state';

/** The icons at the right end of the bar after Files: features still to come, each only an icon with its name and "Soon". */
const SOON: ReadonlyArray<{ readonly key: MessageKey; readonly path: string }> = [
  { key: 'tabs.agents', path: 'M10.5 5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0zM3 13c0-2.5 2.2-4 5-4s5 1.5 5 4' },
  { key: 'tabs.changes', path: 'M8 2v8M4 6h8M4 13h8' },
  { key: 'tabs.prs', path: 'M4.5 5v6M11.5 11V6.5a2 2 0 0 0-2-2H7M8.5 3L7 4.5 8.5 6M6 3.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM6 12.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zM13 12.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z' },
  { key: 'tabs.usage', path: 'M2 13h12M4 13V8M8 13V4M12 13V9' },
];

/**
 * The selected Project's Tabs, above its content. Each Tab shows its number (Ctrl+number goes to it), its name (its
 * first Terminal's until renamed with a double click) and a dot only while a Terminal in it is Waiting or Error. "+"
 * opens the new-terminal picker for a new Tab, as Ctrl+T does. Closing a Tab asks first only while one of its Terminals
 * is Working or Waiting.
 */
@Component({
  selector: 'app-tab-bar',
  imports: [ModalComponent, NewTerminal, TooltipComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './tab-bar.html',
  styleUrl: './tab-bar.css',
})
export class TabBar {
  protected readonly i18n = inject(I18n);
  private readonly state = inject(TabsState);
  protected readonly files = inject(FilesBrowser);

  readonly projectId = input.required<ProjectId>();
  readonly projectName = input.required<string>();
  /** The Tab on screen. */
  readonly activeTabId = input<TabId>();
  readonly selected = output<Tab>();
  readonly newTab = output<Provider | undefined>();
  /** The user closes this Tab (confirmed, when it had to be): the screen moves off it and closes its Terminals. */
  readonly closeTab = output<Tab>();

  protected readonly soon = SOON;
  protected readonly tabs = computed(() => this.state.tabsOf(this.projectId()));
  protected readonly editing = signal<TabId | undefined>(undefined);
  /** The Tab whose close waits for the user. By id: its Terminals may change while the dialog is open. */
  private readonly confirmingId = signal<TabId | undefined>(undefined);
  protected readonly confirming = computed(() => this.tabs().find((tab) => tab.id === this.confirmingId()));
  protected readonly newTabHint = shortcutKeys('newTab').join('+');
  protected readonly filesHint = shortcutKeys('files').join('+');
  private readonly renameInput = viewChild<ElementRef<HTMLInputElement>>('renameInput');

  constructor() {
    effect(() => {
      const field = this.renameInput()?.nativeElement;
      field?.focus();
      field?.select();
    });
  }

  protected nameOf(tab: Tab): string {
    return tab.name ?? this.i18n.t('terminals.name', { number: tab.terminals[0].number });
  }

  protected dot(tab: Tab): 'Waiting' | 'Error' | undefined {
    return tabDot(this.state.statusesOf(tab));
  }

  protected startRename(tab: Tab): void {
    this.editing.set(tab.id);
  }

  protected commitRename(tab: Tab, value: string): void {
    if (this.editing() !== tab.id) return;
    this.editing.set(undefined);
    this.state.rename(tab.id, value);
  }

  protected cancelRename(): void {
    this.editing.set(undefined);
  }

  protected askClose(tab: Tab): void {
    if (closeNeedsConfirm(this.state.statusesOf(tab))) this.confirmingId.set(tab.id);
    else this.closeTab.emit(tab);
  }

  protected confirmClose(): void {
    const tab = this.confirming();
    this.confirmingId.set(undefined);
    if (tab !== undefined) this.closeTab.emit(tab);
  }

  protected cancelClose(): void {
    this.confirmingId.set(undefined);
  }
}
