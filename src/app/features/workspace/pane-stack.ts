import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, linkedSignal, output, signal, viewChild } from '@angular/core';
import type { Provider } from '../../../shared/settings/settings.model';
import { I18n } from '../../core/i18n';
import type { MessageKey } from '../../core/i18n-dictionaries';
import { stackKeys, stackShortcut, type StackShortcut } from '../../core/shortcuts';
import { ModalComponent } from '../../shared/ui/modal/modal';
import { StateComponent } from '../../shared/ui/state/state';
import { NewTerminal } from './new-terminal';
import {
  MAX_VIEWS,
  addToStack,
  canUnstack,
  focusPane,
  moveView,
  reorderView,
  showView,
  split,
  unstack,
  type Pane,
  type PaneId,
  type SplitDirection,
  type TabLayout,
} from './pane-layout';
import { closeNeedsConfirm, type Tab } from './tabs';
import { TabsState } from './tabs-state';
import type { TerminalEntry, TerminalId } from './terminal-entries';
import { TerminalScreen } from './terminal-screen';
import { terminalBadge } from './terminal-view';
import { TerminalsState } from './terminals-state';

/** A View of the Stack, with its Terminal and its place (0-based). */
interface StackView {
  readonly id: TerminalId;
  readonly index: number;
  readonly entry: TerminalEntry;
  readonly name: string;
}

/** The type a dragged View header puts in the drag's data, so drags from elsewhere (files, text) start no drop. */
export const VIEW_MIME = 'application/x-timmy-view';

/** A View header being dragged, and the Pane it comes from. */
export interface ViewDrag {
  readonly view: TerminalId;
  readonly fromPane: PaneId;
}

/** Where a header dragged over this Stack would land: before or after the View at `index`. */
export interface DropMark {
  readonly index: number;
  readonly side: 'before' | 'after';
}

/** What waits for the user's confirmation: closing one View, or the whole Pane. */
interface PendingClose {
  readonly kind: 'view' | 'pane';
  readonly ids: ReadonlyArray<TerminalId>;
  readonly name: string;
}

/**
 * One Pane of a Tab: the header of its expanded View (split right, split down, add to stack, menu, close), the View
 * itself, and the collapsed headers of the rest of its Stack, all in Stack order. It applies the Pane and Stack rules
 * through `TabsState`; the grid around it only lays the Panes out.
 */
@Component({
  selector: 'app-pane-stack',
  imports: [ModalComponent, NewTerminal, StateComponent, TerminalScreen],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pane-stack.html',
  styleUrl: './pane-stack.css',
  host: {
    role: 'region',
    '[attr.aria-label]': 'label()',
    '[class.focused]': 'focused()',
    '(pointerdown)': 'focusSelf()',
    '(focusin)': 'focusSelf()',
    '(document:click)': 'closeMenuOutside($event)',
    '(document:keydown.escape)': 'menuOpen.set(false)',
  },
})
export class PaneStack {
  protected readonly i18n = inject(I18n);
  protected readonly badge = terminalBadge;
  protected readonly keys = stackKeys;
  protected readonly max = MAX_VIEWS;
  private readonly tabs = inject(TabsState);
  private readonly terminals = inject(TerminalsState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly tab = input.required<Tab>();
  readonly pane = input.required<Pane>();
  /** The Project's folder, where new Terminals open. */
  readonly cwd = input.required<string>();
  /** The focused Pane: its keys (Alt+1–3, Alt+Shift+…) work, and its expanded Terminal is the one on screen. */
  readonly focused = input(false);
  /** Whether Split right / Split down are offered: the grid knows the Pane's size in px (see `canSplit`). */
  readonly canSplitRight = input(false);
  readonly canSplitDown = input(false);
  /** Whether a lone View's header can be dragged too, to another Pane: the grid shows all its Panes. */
  readonly movable = input(false);
  /** Where a View dragged over this Stack's headers from the grid would land (the grid owns that drag). */
  readonly dropMark = input<DropMark | undefined>(undefined);

  /** A header started or stopped being dragged; the grid then offers the other Panes as drop targets. */
  readonly dragStarted = output<ViewDrag>();
  readonly dragEnded = output<void>();

  /** The Views whose Terminal is known; one just closed may linger in the layout for a moment. */
  protected readonly views = computed((): ReadonlyArray<StackView> =>
    this.pane().views.flatMap((id, index) => {
      const entry = this.tab().terminals.find((terminal) => terminal.id === id);
      return entry === undefined ? [] : [{ id, index, entry, name: this.i18n.t('terminals.name', { number: entry.number }) }];
    }),
  );
  protected readonly expanded = computed(() => this.views().find((view) => view.id === this.pane().expanded) ?? this.views()[0]);
  protected readonly stacked = computed(() => this.pane().views.length > 1);
  protected readonly draggable = computed(() => this.stacked() || this.movable());
  protected readonly full = computed(() => this.pane().views.length >= MAX_VIEWS);
  protected readonly unstackable = computed(() => {
    const layout = this.tabs.layoutOf(this.tab());
    // Unstacking splits right, so it also needs the room a split right needs.
    return layout !== undefined && this.canSplitRight() && canUnstack(layout, this.pane().id);
  });
  protected readonly label = computed(() => this.i18n.t('pane.label', { name: this.expanded()?.name ?? '' }));
  protected readonly stackLabel = computed(() =>
    this.full() ? this.i18n.t('stack.full', { label: this.i18n.t('stack.add') }) : this.withKeys('stack.add', stackKeys.addToStack),
  );

  /** The header's buttons for a new Terminal, which Alt+Shift+R / D / S press. */
  private readonly splitRightButton = viewChild('splitRight', { read: NewTerminal });
  private readonly splitDownButton = viewChild('splitDown', { read: NewTerminal });
  private readonly addToStackButton = viewChild('addToStack', { read: NewTerminal });

  protected readonly menuOpen = signal(false);
  protected readonly pending = signal<PendingClose | undefined>(undefined);
  /** The View whose header is being dragged, and the place it would land on. */
  protected readonly dragging = linkedSignal<Pane, TerminalId | undefined>({
    source: this.pane,
    // A View dropped on another Pane leaves this one before its header can tell the drag ended.
    computation: (pane, previous) => (previous?.value !== undefined && pane.views.includes(previous.value) ? previous.value : undefined),
  });
  protected readonly dropAt = signal<number | undefined>(undefined);

  constructor() {
    // Captured on the window, like the Workspace's shortcuts, so the focused xterm does not take Alt+… for itself.
    const onKey = (event: KeyboardEvent) => this.onKey(event);
    window.addEventListener('keydown', onKey, { capture: true });
    inject(DestroyRef).onDestroy(() => window.removeEventListener('keydown', onKey, { capture: true }));
  }

  private change(rule: (layout: TabLayout) => TabLayout): void {
    this.tabs.update(this.tab(), rule);
  }

  protected focusSelf(): void {
    if (!this.focused()) this.change((layout) => focusPane(layout, this.pane().id));
  }

  private onKey(event: KeyboardEvent): void {
    if (!this.focused()) return;
    const shortcut = stackShortcut(event);
    // Keys act on what the user sees; behind a dialog they do not.
    if (shortcut === null || document.querySelector('[aria-modal="true"]') !== null) return;
    // A key that would do nothing here goes on to the Terminal: shells and TUIs use Alt+digit and Alt+Shift+arrows too.
    if (!this.applies(shortcut)) return;
    event.preventDefault();
    event.stopPropagation();
    switch (shortcut.id) {
      case 'showView':
        return this.show(shortcut.index);
      case 'moveView':
        return this.move(shortcut.delta);
      case 'unstack':
        return this.unstackExpanded();
      case 'splitRight':
        return this.splitRightButton()?.start();
      case 'splitDown':
        return this.splitDownButton()?.start();
      case 'addToStack':
        return this.addToStackButton()?.start();
    }
  }

  /** Whether the key would do something here, as the header's buttons and menu would. */
  private applies(shortcut: StackShortcut): boolean {
    switch (shortcut.id) {
      case 'showView':
        return this.stacked() && shortcut.index < this.views().length;
      case 'moveView':
        return this.stacked();
      case 'unstack':
        return this.unstackable();
      case 'splitRight':
        return this.canSplitRight();
      case 'splitDown':
        return this.canSplitDown();
      case 'addToStack':
        return !this.full();
    }
  }

  /** A button's tooltip: its name and its keys. */
  protected withKeys(label: MessageKey, keys: ReadonlyArray<string>): string {
    return `${this.i18n.t(label)} (${keys.join('+')})`;
  }

  protected show(index: number): void {
    this.change((layout) => focusPane(showView(layout, this.pane().id, index), this.pane().id));
  }

  protected move(delta: -1 | 1): void {
    const view = this.expanded();
    if (view !== undefined) this.change((layout) => moveView(layout, this.pane().id, view.id, delta));
  }

  protected unstackExpanded(): void {
    const view = this.expanded();
    if (view !== undefined && this.unstackable()) this.change((layout) => unstack(layout, this.pane().id, view.id));
  }

  protected async splitPane(direction: SplitDirection, provider: Provider | undefined): Promise<void> {
    await this.tabs.openInTab(this.tab(), this.cwd(), provider, (layout, terminal) => split(layout, this.pane().id, direction, terminal));
  }

  protected async stack(provider: Provider | undefined): Promise<void> {
    await this.tabs.openInTab(this.tab(), this.cwd(), provider, (layout, terminal) => addToStack(layout, this.pane().id, terminal));
  }

  protected async restart(view: StackView): Promise<void> {
    this.menuOpen.set(false);
    await this.terminals.restart(view.id, this.cwd());
  }

  /** Closing asks first only while one of the Terminals that would close is Working or Waiting. */
  protected askClose(kind: PendingClose['kind']): void {
    this.menuOpen.set(false);
    const view = this.expanded();
    const ids = kind === 'pane' ? this.views().map((each) => each.id) : view === undefined ? [] : [view.id];
    if (ids.length === 0) return;
    const pending = { kind, ids, name: view?.name ?? '' };
    if (closeNeedsConfirm(ids.map((id) => this.tabs.statusOf(id)))) this.pending.set(pending);
    else void this.tabs.closeTerminals(ids);
  }

  protected confirmClose(): void {
    const pending = this.pending();
    this.pending.set(undefined);
    if (pending !== undefined) void this.tabs.closeTerminals(pending.ids);
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenuOutside(event: Event): void {
    const menu = this.host.nativeElement.querySelector('.menu-anchor');
    if (menu !== null && !menu.contains(event.target as Node)) this.menuOpen.set(false);
  }

  protected soon(key: MessageKey): string {
    return this.i18n.t('tabs.soon', { name: this.i18n.t(key) });
  }

  // ---- Dragging a header reorders the Stack; the grid takes it to other Panes ----

  protected dragStart(event: DragEvent, view: StackView): void {
    this.dragging.set(view.id);
    event.dataTransfer?.setData(VIEW_MIME, view.id);
    event.dataTransfer?.setData('text/plain', view.name);
    if (event.dataTransfer !== null && event.dataTransfer !== undefined) event.dataTransfer.effectAllowed = 'move';
    this.dragStarted.emit({ view: view.id, fromPane: this.pane().id });
  }

  protected dragOver(event: DragEvent, view: StackView): void {
    if (this.dragging() === undefined) return;
    event.preventDefault();
    this.dropAt.set(view.index);
  }

  protected drop(event: DragEvent, view: StackView): void {
    const dragged = this.dragging();
    event.preventDefault();
    this.dragEnd();
    if (dragged !== undefined && dragged !== view.id) this.change((layout) => reorderView(layout, this.pane().id, dragged, view.index));
  }

  protected dragEnd(): void {
    this.dragging.set(undefined);
    this.dropAt.set(undefined);
  }

  protected headerDragEnd(): void {
    this.dragEnd();
    this.dragEnded.emit();
  }

  /** The drop line goes above the target when the View moves up, below it when it moves down. */
  protected dropSide(view: StackView): 'before' | 'after' | undefined {
    const mark = this.dropMark();
    if (mark !== undefined) return mark.index === view.index ? mark.side : undefined;
    const dragged = this.dragging();
    if (dragged === undefined || dragged === view.id || this.dropAt() !== view.index) return undefined;
    return this.pane().views.indexOf(dragged) > view.index ? 'before' : 'after';
  }
}
