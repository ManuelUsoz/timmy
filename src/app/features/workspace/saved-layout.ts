import type { ProjectId } from '../../../shared/projects/projects.model';
import { defaultTerminalName } from '../../../shared/workspace/terminal-name';
import type { ProjectLayout, SavedTab } from '../../../shared/workspace/workspace.model';
import { focusPane, panesOf, withoutView, type TabLayout } from './pane-layout';
import type { Tab, TabId } from './tabs';
import type { TerminalEntry } from './terminal-entries';
import { fileView } from './views';

/** The files of the layout's File Views, in the order of its Panes and, in a Stack, of its Views. */
const filesIn = (layout: TabLayout): ReadonlyArray<string> =>
  panesOf(layout).flatMap((pane) => pane.views.flatMap((view) => (view.kind === 'file' ? [view.path] : [])));

/**
 * The layout as if the Tab's preview were closed (ADR 0013): only pinned File Views are saved, each as its path in the
 * Project and its place in the layout, so every File View of a saved layout is a pinned one.
 */
const withoutPreview = (layout: TabLayout | undefined, pinned: ReadonlyArray<string>): TabLayout | undefined => {
  let next = layout;
  for (const path of layout === undefined ? [] : filesIn(layout)) {
    if (!pinned.includes(path) && next !== undefined) next = withoutView(next, fileView(path));
  }
  return next;
};

/**
 * A Project's Tabs as they are saved (ADR 0011): the user's name for each, the Terminals in it (identity, number,
 * name, Provider) and the layout they are in, with the Tab's pinned File Views (`pinnedOf`, their paths) in their
 * places. A Terminal's process, output and status are not; nor a file's content, or the preview.
 */
export const savedTabsOf = (
  tabs: ReadonlyArray<Tab>,
  layoutOf: (tab: Tab) => TabLayout | undefined,
  pinnedOf: (tab: Tab) => ReadonlyArray<string>,
): ReadonlyArray<SavedTab> =>
  tabs.map((tab) => {
    const layout = withoutPreview(layoutOf(tab), pinnedOf(tab));
    return {
      tabId: tab.id,
      ...(tab.name === undefined ? {} : { name: tab.name }),
      terminals: tab.terminals.map((terminal) => ({
        terminalId: terminal.id,
        number: terminal.number,
        name: terminal.name,
        ...(terminal.provider === undefined ? {} : { provider: terminal.provider }),
      })),
      ...(layout === undefined ? {} : { layout }),
    };
  });

/**
 * What a restart brings back: the Terminals (all Idle), the names the user gave Tabs, the layouts kept, their pinned
 * File Views and the numbers given.
 */
export interface Restored {
  readonly entries: ReadonlyArray<TerminalEntry>;
  readonly names: ReadonlyMap<TabId, string>;
  readonly layouts: ReadonlyMap<TabId, TabLayout>;
  /** The files of each Tab's pinned File Views, as its layout places them. Each is read again: nothing of it was saved. */
  readonly pinned: ReadonlyMap<TabId, ReadonlyArray<string>>;
  /** The highest number each Project had given a Terminal. */
  readonly lastNumbers: ReadonlyMap<ProjectId, number>;
}

/** A layout whose focused Pane is not in it focuses its first. */
const withFocus = (layout: TabLayout): TabLayout => {
  const panes = panesOf(layout);
  return panes.some((pane) => pane.id === layout.focused) || panes.length === 0 ? layout : focusPane(layout, panes[0].id);
};

/** Every saved Terminal comes back Idle, not started: the user starts each one (ADR 0011). One saved without a name takes its default. */
export const restoredFrom = (saved: ReadonlyArray<ProjectLayout>): Restored => {
  const entries: TerminalEntry[] = [];
  const names = new Map<TabId, string>();
  const layouts = new Map<TabId, TabLayout>();
  const pinned = new Map<TabId, ReadonlyArray<string>>();
  const lastNumbers = new Map<ProjectId, number>();
  for (const { projectId, tabs, lastNumber } of saved) {
    lastNumbers.set(projectId, lastNumber);
    for (const tab of tabs) {
      if (tab.terminals.length === 0) continue;
      for (const terminal of tab.terminals) {
        entries.push({
          id: terminal.terminalId,
          projectId,
          tabId: tab.tabId,
          number: terminal.number,
          name: terminal.name ?? defaultTerminalName(terminal.provider, terminal.number),
          state: 'Idle',
          activity: 'Idle',
          ...(terminal.provider === undefined ? {} : { provider: terminal.provider }),
        });
      }
      if (tab.name !== undefined) names.set(tab.tabId, tab.name);
      if (tab.layout === undefined) continue;
      layouts.set(tab.tabId, withFocus(tab.layout));
      const files = filesIn(tab.layout);
      if (files.length > 0) pinned.set(tab.tabId, files);
    }
  }
  return { entries, names, layouts, pinned, lastNumbers };
};
