import type { ProjectLayout, SavedTab } from '../../../shared/workspace/workspace.model';
import { focusPane, panesOf, type TabLayout } from './pane-layout';
import type { Tab, TabId } from './tabs';
import type { TerminalEntry } from './terminal-entries';

/**
 * A Project's Tabs as they are saved (ADR 0011): the user's name for each, the Terminals in it (identity, number,
 * Provider) and the layout they are in. A Terminal's process, output and status are not.
 */
export const savedTabsOf = (tabs: ReadonlyArray<Tab>, layoutOf: (tab: Tab) => TabLayout | undefined): ReadonlyArray<SavedTab> =>
  tabs.map((tab) => {
    const layout = layoutOf(tab);
    return {
      tabId: tab.id,
      ...(tab.name === undefined ? {} : { name: tab.name }),
      terminals: tab.terminals.map((terminal) => ({
        terminalId: terminal.id,
        number: terminal.number,
        ...(terminal.provider === undefined ? {} : { provider: terminal.provider }),
      })),
      ...(layout === undefined ? {} : { layout }),
    };
  });

/** What a restart brings back: the Terminals (all Idle), the names the user gave Tabs, and the layouts kept. */
export interface Restored {
  readonly entries: ReadonlyArray<TerminalEntry>;
  readonly names: ReadonlyMap<TabId, string>;
  readonly layouts: ReadonlyMap<TabId, TabLayout>;
}

/** A layout whose focused Pane is not in it focuses its first. */
const withFocus = (layout: TabLayout): TabLayout => {
  const panes = panesOf(layout);
  return panes.some((pane) => pane.id === layout.focused) || panes.length === 0 ? layout : focusPane(layout, panes[0].id);
};

/** Every saved Terminal comes back Idle, not started: the user starts each one (ADR 0011). */
export const restoredFrom = (saved: ReadonlyArray<ProjectLayout>): Restored => {
  const entries: TerminalEntry[] = [];
  const names = new Map<TabId, string>();
  const layouts = new Map<TabId, TabLayout>();
  for (const { projectId, tabs } of saved) {
    for (const tab of tabs) {
      if (tab.terminals.length === 0) continue;
      for (const terminal of tab.terminals) {
        entries.push({
          id: terminal.terminalId,
          projectId,
          tabId: tab.tabId,
          number: terminal.number,
          state: 'Idle',
          activity: 'Idle',
          ...(terminal.provider === undefined ? {} : { provider: terminal.provider }),
        });
      }
      if (tab.name !== undefined) names.set(tab.tabId, tab.name);
      if (tab.layout !== undefined) layouts.set(tab.tabId, withFocus(tab.layout));
    }
  }
  return { entries, names, layouts };
};
