import { Injectable, computed, inject, signal } from '@angular/core';
import type { TerminalStatus } from '../../../shared/notification/notification.model';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { ProjectLayout, SavedTab } from '../../../shared/workspace/workspace.model';
import { NotificationsState } from '../shell/notifications-state';
import type { Provider } from '../../../shared/settings/settings.model';
import { LineSelections } from './line-selection';
import { bringForward, inStep, replaceView, type TabLayout } from './pane-layout';
import type { TerminalEntry, TerminalId } from './terminal-entries';
import { TerminalsState } from './terminals-state';
import { restoredFrom, savedTabsOf } from './saved-layout';
import { tabsOf, type Tab, type TabId } from './tabs';
import { fileView, terminalView, type ViewId } from './views';

/** A File View open in a Tab (GLOSSARY: File View): its file, and whether it is pinned or the Tab's preview. */
export interface OpenFile {
  readonly path: string;
  readonly pinned: boolean;
}

/**
 * The Tabs of every Project. `WorkspacePersistence` saves them and brings them back (ADR 0011). A Tab is made of the Terminals
 * that carry its id (see `tabs.ts`); this keeps what is not in them: the names the user gave, and the Ctrl+T requests.
 */
@Injectable({ providedIn: 'root' })
export class TabsState {
  private readonly terminals = inject(TerminalsState);
  private readonly notifications = inject(NotificationsState);
  private readonly selections = inject(LineSelections);
  private readonly names = signal<ReadonlyMap<TabId, string>>(new Map());
  /** Each Ctrl+T adds one; the New Tab button on screen opens the new-terminal picker for it. */
  readonly newTabRequests = signal(0);
  /** When each Tab was last on screen, as a count that grows with each visit: the Switcher's most-recent-first order. */
  private readonly visitOrder = signal<ReadonlyMap<TabId, number>>(new Map());
  private visitCount = 0;
  readonly visits = this.visitOrder.asReadonly();

  /** Every Terminal's status, as its latest Notification says; a Terminal with none is Idle. */
  private readonly status = computed(
    () => new Map<TerminalId, TerminalStatus>(this.notifications.notifications().map((notification) => [notification.source.terminalId, notification.type])),
  );

  /**
   * Brings back what a previous run saved: its Terminals (Idle, not started), the names and the layouts, with their
   * pinned File Views. A Tab already here, opened before the saved ones arrived, is kept as it is.
   */
  restore(saved: ReadonlyArray<ProjectLayout>): void {
    const restored = restoredFrom(saved);
    this.terminals.restore(restored.entries, restored.lastNumbers);
    this.names.update((names) => new Map([...restored.names, ...names]));
    // Every File View of a saved layout is a pinned one (ADR 0013); they come back with the layout that places them.
    const kept = this.layouts();
    const pinned = [...restored.pinned]
      .filter(([id]) => !kept.has(id))
      .map(([id, paths]) => [id, paths.map((path): OpenFile => ({ path, pinned: true }))] as const);
    this.files.update((files) => new Map([...pinned, ...files]));
    this.layouts.update((layouts) => new Map([...restored.layouts, ...layouts]));
  }

  /** The Project's Tabs as they are saved: what a restart brings back. */
  savedTabs(projectId: ProjectId): ReadonlyArray<SavedTab> {
    return savedTabsOf(
      this.tabsOf(projectId),
      (tab) => this.layoutOf(tab),
      (tab) => this.filesOf(tab).flatMap((open) => (open.pinned ? [open.path] : [])),
    );
  }

  tabsOf(projectId: ProjectId): ReadonlyArray<Tab> {
    return tabsOf(this.terminals.entries(), projectId, this.names());
  }

  statusesOf(tab: Tab): ReadonlyArray<TerminalStatus> {
    const status = this.status();
    return tab.terminals.map((terminal) => status.get(terminal.id) ?? 'Idle');
  }

  /** The Tab is on screen now: it becomes the most recent. */
  visit(id: TabId): void {
    if (this.visitOrder().get(id) === this.visitCount) return;
    this.visitCount += 1;
    const count = this.visitCount;
    this.visitOrder.update((visits) => new Map(visits).set(id, count));
  }

  requestNewTab(): void {
    this.newTabRequests.update((count) => count + 1);
  }

  /** A blank name gives the Tab back its first Terminal's. */
  rename(id: TabId, name: string): void {
    const trimmed = name.trim();
    this.names.update((names) => {
      const next = new Map(names);
      if (trimmed === '') next.delete(id);
      else next.set(id, trimmed);
      return next;
    });
  }

  /** Closes every Terminal of the Tab, which ends the Tab, its File Views with it. */
  async close(tab: Tab): Promise<void> {
    await Promise.all(tab.terminals.map((terminal) => this.terminals.close(terminal.id)));
    this.rename(tab.id, '');
    this.setFiles(tab.id, []);
    this.visitOrder.update((visits) => {
      const next = new Map(visits);
      next.delete(tab.id);
      return next;
    });
    this.layouts.update((layouts) => {
      const next = new Map(layouts);
      next.delete(tab.id);
      return next;
    });
  }

  /** Closes every Tab of the Project, and so all of its Terminals: what removing the Project leaves behind. */
  async closeProject(projectId: ProjectId): Promise<void> {
    await Promise.all(this.tabsOf(projectId).map((tab) => this.close(tab)));
  }

  /** The status of every Terminal of the Project, to tell whether removing it needs the user's confirmation. */
  projectStatuses(projectId: ProjectId): ReadonlyArray<TerminalStatus> {
    return this.tabsOf(projectId).flatMap((tab) => this.statusesOf(tab));
  }

  // ---- Panes and Stacks (#120) -------------------------------------------------------------------------------------

  /** What the user did to each Tab's layout. What is shown is this kept in step with the Tab's Terminals (`layoutOf`). */
  private readonly layouts = signal<ReadonlyMap<TabId, TabLayout>>(new Map());

  /** The Tab's Panes and Stacks as they are now; undefined only for a Tab with no Terminals. */
  layoutOf(tab: Tab): TabLayout | undefined {
    return this.layoutWith(tab.id, tab.terminals.map((terminal) => terminal.id));
  }

  /** The kept layout of a Tab, following restarts, in step with these Terminals and the Tab's File Views. */
  private layoutWith(id: TabId, terminals: ReadonlyArray<TerminalId>): TabLayout | undefined {
    let stored = this.layouts().get(id);
    if (stored !== undefined) {
      for (const [from, to] of this.terminals.restarts()) stored = replaceView(stored, terminalView(from), terminalView(to));
    }
    // A Tab exists only while it has a Terminal: without one, its File Views have nowhere to be.
    if (terminals.length === 0) return undefined;
    const files = (this.files().get(id) ?? []).map((open) => fileView(open.path));
    return inStep(stored, [...terminals.map(terminalView), ...files]);
  }

  // ---- File Views (ADR 0013) ---------------------------------------------------------------------------------------

  /** The File Views open in each Tab, in the order they were opened. A Tab has at most one that is not pinned. */
  private readonly files = signal<ReadonlyMap<TabId, ReadonlyArray<OpenFile>>>(new Map());

  filesOf(tab: Tab): ReadonlyArray<OpenFile> {
    return this.files().get(tab.id) ?? [];
  }

  /** Ticks with the View to take the keyboard: a file picked in the tree focuses its File View, as a click on it would. */
  readonly focusRequest = signal<{ readonly tab: TabId; readonly view: ViewId } | undefined>(undefined);

  /**
   * A file picked in the Files browser opens in the Tab (ADR 0013). Already open: its View comes forward (and is pinned
   * if `pin`). Otherwise it takes the preview's place, or with no preview opens like a new Terminal: a Pane to the right
   * of the focused one, or a place in a Stack with room at 6 Panes. Either way its Pane is focused and takes the keyboard.
   * `pin` (a double click) opens it pinned; a click opens a preview.
   */
  openFile(tab: Tab, path: string, pin = false): void {
    const view = fileView(path);
    const open = this.filesOf(tab);
    const current = this.layoutOf(tab);
    if (current === undefined) return;
    const existing = open.find((each) => each.path === path);
    const preview = open.find((each) => !each.pinned);
    if (existing !== undefined) {
      if (pin) this.setFiles(tab.id, open.map((each) => (each.path === path ? { path, pinned: true } : each)));
      this.keep(tab.id, bringForward(current, view));
    } else if (preview !== undefined) {
      // Placed on the layout before the files change, so the new View takes the preview's place instead of a new Pane.
      this.keep(tab.id, bringForward(replaceView(current, fileView(preview.path), view), view));
      this.setFiles(tab.id, open.map((each) => (each === preview ? { path, pinned: pin } : each)));
    } else {
      this.setFiles(tab.id, [...open, { path, pinned: pin }]);
      const placed = this.layoutOf(tab);
      if (placed !== undefined) this.keep(tab.id, bringForward(placed, view));
    }
    this.focusRequest.set({ tab: tab.id, view });
  }

  /** The pin button, or a drag: the File View stays until closed; the next file picked opens beside it. */
  pinFile(tab: Tab, path: string): void {
    this.setFiles(tab.id, this.filesOf(tab).map((each) => (each.path === path ? { path, pinned: true } : each)));
  }

  /** Closes these File Views of the Tab; a Pane left empty goes. */
  closeFiles(tab: Tab, paths: ReadonlyArray<string>): void {
    this.setFiles(tab.id, this.filesOf(tab).filter((each) => !paths.includes(each.path)));
  }

  private setFiles(id: TabId, files: ReadonlyArray<OpenFile>): void {
    // A File View that closes (or a preview replaced) takes its Line selection with it.
    this.selections.retain(id, files.map((open) => open.path));
    this.files.update((all) => {
      const next = new Map(all);
      if (files.length === 0) next.delete(id);
      else next.set(id, files);
      return next;
    });
  }

  private keep(id: TabId, layout: TabLayout): void {
    this.layouts.update((layouts) => new Map(layouts).set(id, layout));
  }

  /** Applies a rule to the Tab's current layout and keeps the result. */
  update(tab: Tab, change: (layout: TabLayout) => TabLayout | undefined): void {
    const current = this.layoutOf(tab);
    if (current === undefined) return;
    const next = change(current);
    this.layouts.update((layouts) => {
      const copy = new Map(layouts);
      if (next === undefined) copy.delete(tab.id);
      else copy.set(tab.id, next);
      return copy;
    });
  }

  /**
   * Opens a Terminal in this Tab (a local entry if main cannot start one) and places it with `place`, e.g. a split or
   * a Stack. Returns it, so the screen can show its route.
   */
  async openInTab(tab: Tab, cwd: string, provider: Provider | undefined, place: (layout: TabLayout, view: ViewId) => TabLayout): Promise<TerminalEntry> {
    const projectId = tab.terminals[0].projectId;
    const terminal = (await this.terminals.createLive(projectId, cwd, provider, tab.id)) ?? this.terminals.create(projectId, tab.id);
    // Placed on the layout as it is now, not as it was before the await, so a focus, resize or other split made while
    // the Terminal started is kept; and as it is without the new Terminal, to which `inStep` would otherwise have given a
    // Pane of its own, taking a share from the others.
    const others = this.tabsOf(projectId)
      .find((each) => each.id === tab.id)
      ?.terminals.map((each) => each.id)
      .filter((id) => id !== terminal.id);
    const current = others === undefined ? undefined : this.layoutWith(tab.id, others);
    if (current !== undefined) this.layouts.update((layouts) => new Map(layouts).set(tab.id, place(current, terminalView(terminal.id))));
    return terminal;
  }

  /**
   * Closes these Terminals of the Tab; their Views, and any Pane left empty, go with them. A Tab whose last Terminal
   * closed is gone, and its File Views, pinned ones included, close with it.
   */
  async closeTerminals(terminals: ReadonlyArray<TerminalId>): Promise<void> {
    await Promise.all(terminals.map((id) => this.terminals.close(id)));
    const live = new Set(this.terminals.entries().map((entry) => entry.tabId));
    this.files.update((all) => new Map([...all].filter(([id]) => live.has(id))));
    this.selections.retainTabs(live);
  }

  statusOf(terminal: TerminalId): TerminalStatus {
    return this.status().get(terminal) ?? 'Idle';
  }
}
