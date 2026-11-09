import { ProjectId } from '../../../shared/projects/projects.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { PaneId, TabId, type ProjectLayout } from '../../../shared/workspace/workspace.model';
import { split, singlePane, panesOf } from './pane-layout';
import { restoredFrom, savedTabsOf } from './saved-layout';
import { tabsOf } from './tabs';
import type { TerminalEntry } from './terminal-entries';

const project = ProjectId.make('p-timmy');
const entry = (id: string, tabId: string, number: number, provider?: 'ClaudeCode'): TerminalEntry => ({
  id: TerminalId.make(id),
  projectId: project,
  tabId: TabId.make(tabId),
  number,
  state: 'Live',
  activity: 'Active',
  ...(provider === undefined ? {} : { provider }),
});

describe('saved layout', () => {
  const entries = [entry('a', 't1', 1, 'ClaudeCode'), entry('b', 't1', 2), entry('c', 't2', 3)];
  const layout = split(singlePane(TerminalId.make('a')), PaneId.make('a'), 'right', TerminalId.make('b'));
  const layouts = new Map([[TabId.make('t1'), layout]]);
  const tabs = tabsOf(entries, project, new Map([[TabId.make('t1'), 'Work']]));

  it('saves what a Tab keeps: its name, its Terminals (number and Provider) and its layout, and nothing of the process', () => {
    expect(savedTabsOf(tabs, (tab) => layouts.get(tab.id))).toEqual([
      {
        tabId: 't1',
        name: 'Work',
        terminals: [
          { terminalId: 'a', number: 1, provider: 'ClaudeCode' },
          { terminalId: 'b', number: 2 },
        ],
        layout,
      },
      { tabId: 't2', terminals: [{ terminalId: 'c', number: 3 }] },
    ]);
  });

  it('restores every Terminal Idle, under its saved id, in its Tab, with its Provider', () => {
    const saved: ProjectLayout[] = [{ projectId: project, tabs: savedTabsOf(tabs, (tab) => layouts.get(tab.id)) }];
    const restored = restoredFrom(saved);
    expect(restored.entries).toEqual([
      { id: 'a', projectId: project, tabId: 't1', number: 1, state: 'Idle', activity: 'Idle', provider: 'ClaudeCode' },
      { id: 'b', projectId: project, tabId: 't1', number: 2, state: 'Idle', activity: 'Idle' },
      { id: 'c', projectId: project, tabId: 't2', number: 3, state: 'Idle', activity: 'Idle' },
    ]);
    expect(restored.names).toEqual(new Map([[TabId.make('t1'), 'Work']]));
    expect(restored.layouts).toEqual(new Map([[TabId.make('t1'), layout]]));
  });

  it('restores a layout whose focused Pane is gone onto its first Pane', () => {
    const broken = { ...layout, focused: PaneId.make('nowhere') };
    const restored = restoredFrom([{ projectId: project, tabs: [{ tabId: TabId.make('t1'), terminals: [{ terminalId: TerminalId.make('a'), number: 1 }, { terminalId: TerminalId.make('b'), number: 2 }], layout: broken }] }]);
    expect(restored.layouts.get(TabId.make('t1'))?.focused).toBe(panesOf(layout)[0].id);
  });

  it('leaves a Tab saved without a layout to get the default one', () => {
    const restored = restoredFrom([{ projectId: project, tabs: [{ tabId: TabId.make('t1'), terminals: [{ terminalId: TerminalId.make('a'), number: 1 }] }] }]);
    expect(restored.layouts.size).toBe(0);
  });

  it('skips a saved Tab with no Terminals: Timmy never keeps an empty Tab', () => {
    const restored = restoredFrom([{ projectId: project, tabs: [{ tabId: TabId.make('t1'), terminals: [] }] }]);
    expect(restored.entries).toEqual([]);
  });
});
