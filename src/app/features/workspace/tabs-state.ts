import { Injectable, computed, inject, signal } from '@angular/core';
import type { TerminalStatus } from '../../../shared/notification/notification.model';
import type { ProjectId } from '../../../shared/projects/projects.model';
import { NotificationsState } from '../shell/notifications-state';
import type { TerminalId } from './terminal-entries';
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
  }
}
