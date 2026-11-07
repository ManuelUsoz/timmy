import { Injectable, computed, inject, signal } from '@angular/core';
import type { TerminalStatus } from '../../../shared/notification/notification.model';
import type { ProjectId } from '../../../shared/projects/projects.model';
import { NotificationsState } from '../shell/notifications-state';
import type { Provider } from '../../../shared/settings/settings.model';
import { inStep, replaceTerminal, type TabLayout } from './pane-layout';
import type { TerminalEntry, TerminalId } from './terminal-entries';
import { TerminalsState } from './terminals-state';
import { tabsOf, type Tab, type TabId } from './tabs';

/**
 * The Tabs of every Project, for this app run (saving them is a later ticket, ADR 0011). A Tab is made of the Terminals
 * that carry its id (see `tabs.ts`); this keeps what is not in them: the names the user gave, and the Ctrl+T requests.
 */
@Injectable({ providedIn: 'root' })
export class TabsState {
  private readonly terminals = inject(TerminalsState);
  private readonly notifications = inject(NotificationsState);
  private readonly names = signal<ReadonlyMap<TabId, string>>(new Map());
  /** Each Ctrl+T adds one; the New Tab button on screen opens the new-terminal picker for it. */
  readonly newTabRequests = signal(0);

  /** Every Terminal's status, as its latest Notification says; a Terminal with none is Idle. */
  private readonly status = computed(
    () => new Map<TerminalId, TerminalStatus>(this.notifications.notifications().map((notification) => [notification.source.terminalId, notification.type])),
  );

  tabsOf(projectId: ProjectId): ReadonlyArray<Tab> {
    return tabsOf(this.terminals.entries(), projectId, this.names());
  }

  statusesOf(tab: Tab): ReadonlyArray<TerminalStatus> {
    const status = this.status();
    return tab.terminals.map((terminal) => status.get(terminal.id) ?? 'Idle');
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

  /** Closes every Terminal of the Tab, which ends the Tab. */
  async close(tab: Tab): Promise<void> {
    await Promise.all(tab.terminals.map((terminal) => this.terminals.close(terminal.id)));
    this.rename(tab.id, '');
    this.layouts.update((layouts) => {
      const next = new Map(layouts);
      next.delete(tab.id);
      return next;
    });
  }

  // ---- Panes and Stacks (#120) -------------------------------------------------------------------------------------

  /** What the user did to each Tab's layout. What is shown is this kept in step with the Tab's Terminals (`layoutOf`). */
  private readonly layouts = signal<ReadonlyMap<TabId, TabLayout>>(new Map());

  /** The Tab's Panes and Stacks as they are now; undefined only for a Tab with no Terminals. */
  layoutOf(tab: Tab): TabLayout | undefined {
    return this.layoutWith(tab.id, tab.terminals.map((terminal) => terminal.id));
  }

  /** The kept layout of a Tab, following restarts, in step with these Terminals. */
  private layoutWith(id: TabId, terminals: ReadonlyArray<TerminalId>): TabLayout | undefined {
    let stored = this.layouts().get(id);
    if (stored !== undefined) {
      for (const [from, to] of this.terminals.restarts()) stored = replaceTerminal(stored, from, to);
    }
    return inStep(stored, terminals);
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
  async openInTab(tab: Tab, cwd: string, provider: Provider | undefined, place: (layout: TabLayout, terminal: TerminalId) => TabLayout): Promise<TerminalEntry> {
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
    if (current !== undefined) this.layouts.update((layouts) => new Map(layouts).set(tab.id, place(current, terminal.id)));
    return terminal;
  }

  /** Closes these Terminals of the Tab; their Views, and any Pane left empty, go with them. */
  async closeTerminals(terminals: ReadonlyArray<TerminalId>): Promise<void> {
    await Promise.all(terminals.map((id) => this.terminals.close(id)));
  }

  statusOf(terminal: TerminalId): TerminalStatus {
    return this.status().get(terminal) ?? 'Idle';
  }
}
