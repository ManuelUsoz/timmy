import { Schema } from 'effect';
import type { TerminalStatus } from '../../../shared/notification/notification.model';
import type { ProjectId } from '../../../shared/projects/projects.model';
import { panesOf, type TabLayout } from './pane-layout';
import type { TerminalEntry } from './terminal-entries';

/** A Tab of a Project (GLOSSARY: Tab). Lives in memory for this app run; saving Tabs is ADR 0011's job. */
export const TabId = Schema.String.pipe(Schema.brand('TabId'));
export type TabId = typeof TabId.Type;

/**
 * A Tab and the Terminals in it. A Tab is the Terminals that carry its id, so it exists exactly as long as it holds a
 * Terminal: Timmy never keeps, or makes, an empty one.
 */
export interface Tab {
  readonly id: TabId;
  /** In the order they were opened; the first names the Tab until the user renames it. */
  readonly terminals: ReadonlyArray<TerminalEntry>;
  /** The name the user gave it; absent while it takes its first Terminal's. */
  readonly name?: string;
}

/** The Tabs of a Project, in the order they were opened. */
export const tabsOf = (entries: ReadonlyArray<TerminalEntry>, projectId: ProjectId, names: ReadonlyMap<TabId, string>): ReadonlyArray<Tab> => {
  const groups = new Map<TabId, TerminalEntry[]>();
  for (const entry of entries) {
    if (entry.projectId === projectId) groups.set(entry.tabId, [...(groups.get(entry.tabId) ?? []), entry]);
  }
  return Array.from(groups, ([id, terminals]) => {
    const name = names.get(id);
    return name === undefined ? { id, terminals } : { id, terminals, name };
  });
};

/**
 * Where a Tab is shown: the route of its focused Pane's expanded View, so coming back to a Tab finds it as it was left.
 * With no layout given (or one that no longer holds that Terminal), its first Terminal's.
 */
export const tabPath = (tab: Tab, layout?: TabLayout): ReadonlyArray<string> => terminalPath(frontTerminal(tab, layout));

/** Where a Terminal is shown: its route, which brings its Tab, its Pane and its place in its Stack to the front. */
export const terminalPath = (terminal: Pick<TerminalEntry, 'projectId' | 'id'>): ReadonlyArray<string> => ['/projects', terminal.projectId, 'terminals', terminal.id];

/** The Terminal a Tab has in front: its focused Pane's expanded View, else (no layout, or a stale one) its first. */
export const frontTerminal = (tab: Tab, layout?: TabLayout): TerminalEntry => {
  const focused = layout === undefined ? undefined : panesOf(layout).find((pane) => pane.id === layout.focused)?.expanded;
  return tab.terminals.find((entry) => entry.id === focused) ?? tab.terminals[0];
};

/** The Tab that takes the place of a closed one: the next, else the previous; none when it was the only one. */
export const neighbourOf = (tabs: ReadonlyArray<Tab>, closed: TabId): Tab | undefined => {
  const index = tabs.findIndex((tab) => tab.id === closed);
  return index < 0 ? undefined : (tabs[index + 1] ?? tabs[index - 1]);
};

/** What a Tab's dot shows: Waiting or Error while one of its Terminals is in it (Waiting first), nothing otherwise. */
export const tabDot = (statuses: ReadonlyArray<TerminalStatus>): 'Waiting' | 'Error' | undefined =>
  statuses.includes('Waiting') ? 'Waiting' : statuses.includes('Error') ? 'Error' : undefined;

/** Closing a Tab closes its Terminals; the user confirms only while one of them is Working or Waiting. */
export const closeNeedsConfirm = (statuses: ReadonlyArray<TerminalStatus>): boolean =>
  statuses.some((status) => status === 'Working' || status === 'Waiting');
