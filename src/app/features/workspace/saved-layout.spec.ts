import { Schema } from 'effect';
import { ProjectId } from '../../../shared/projects/projects.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { PaneId, ProjectLayout as ProjectLayoutSchema, TabId, type ProjectLayout, type SavedTab } from '../../../shared/workspace/workspace.model';
import { addToStack, bringForward, panesOf, singlePane, split, type TabLayout } from './pane-layout';
import { restoredFrom, savedTabsOf } from './saved-layout';
import { tabsOf } from './tabs';
import type { TerminalEntry } from './terminal-entries';
import { fileView, terminalView, viewKey } from './views';

const project = ProjectId.make('p-timmy');
const entry = (id: string, tabId: string, number: number, provider?: 'ClaudeCode'): TerminalEntry => ({
  id: TerminalId.make(id),
  projectId: project,
  tabId: TabId.make(tabId),
  number,
  name: provider === undefined ? `shell ${number}` : `claude ${number}`,
  state: 'Live',
  activity: 'Active',
  ...(provider === undefined ? {} : { provider }),
});

describe('saved layout', () => {
  const entries = [entry('a', 't1', 1, 'ClaudeCode'), entry('b', 't1', 2), entry('c', 't2', 3)];
  const layout = split(singlePane(terminalView(TerminalId.make('a'))), PaneId.make('a'), 'right', terminalView(TerminalId.make('b')));
  const layouts = new Map([[TabId.make('t1'), layout]]);
  const tabs = tabsOf(entries, project, new Map([[TabId.make('t1'), 'Work']]));

  it('saves what a Tab keeps: its name, its Terminals (number, name and Provider) and its layout, and nothing of the process', () => {
    expect(savedTabsOf(tabs, (tab) => layouts.get(tab.id), () => [])).toEqual([
      {
        tabId: 't1',
        name: 'Work',
        terminals: [
          { terminalId: 'a', number: 1, name: 'claude 1', provider: 'ClaudeCode' },
          { terminalId: 'b', number: 2, name: 'shell 2' },
        ],
        layout,
      },
      { tabId: 't2', terminals: [{ terminalId: 'c', number: 3, name: 'shell 3' }] },
    ]);
  });

  describe('with File Views (ADR 0013)', () => {
    const t1 = TabId.make('t1');
    // Pane a: a Stack of its Terminal, util.ts and main.ts (expanded). Pane b: its Terminal, above notes.md. Then README.md.
    const stacked = bringForward(addToStack(addToStack(layout, PaneId.make('a'), fileView('src/util.ts')), PaneId.make('a'), fileView('src/main.ts')), fileView('src/main.ts'));
    const withFiles = split(split(stacked, PaneId.make('b'), 'right', fileView('README.md')), PaneId.make('b'), 'down', fileView('notes.md'));
    const keys = (shown: TabLayout | undefined) => (shown === undefined ? [] : panesOf(shown).map((pane) => pane.views.map(viewKey)));
    const saveWith = (shown: TabLayout, pinned: ReadonlyArray<string>) =>
      savedTabsOf(tabs, (tab) => (tab.id === t1 ? shown : undefined), (tab) => (tab.id === t1 ? pinned : []));
    /** What the store gives back: the saved Tabs through their wire form, as a restart reads them. */
    const reloaded = (saved: ReadonlyArray<SavedTab>): ProjectLayout[] => [
      Schema.decodeUnknownSync(ProjectLayoutSchema)(Schema.encodeSync(ProjectLayoutSchema)({ projectId: project, tabs: saved, lastNumber: 3 })),
    ];

    it('brings pinned File Views back in their Pane or Stack, in order, each still pinned; the preview is not saved', () => {
      const restored = restoredFrom(reloaded(saveWith(withFiles, ['README.md', 'src/main.ts', 'src/util.ts'])));
      // notes.md was the preview: its Pane is gone, and the others are as they were.
      expect(keys(restored.layouts.get(t1))).toEqual([['a', 'file:src/util.ts', 'file:src/main.ts'], ['b'], ['file:README.md']]);
      expect(panesOf(restored.layouts.get(t1)!)[0].expanded).toEqual(fileView('src/main.ts'));
      expect(restored.pinned).toEqual(new Map([[t1, ['src/util.ts', 'src/main.ts', 'README.md']]]));
    });

    it('saves the layout as if the preview were closed, wherever it is, a Stack included', () => {
      const [saved] = saveWith(withFiles, ['README.md', 'src/util.ts', 'notes.md']);
      expect(keys(saved.layout)).toEqual([['a', 'file:src/util.ts'], ['b'], ['file:notes.md'], ['file:README.md']]);
      expect(restoredFrom(reloaded([saved])).pinned.get(t1)).toEqual(['src/util.ts', 'notes.md', 'README.md']);
    });

    it('saves nothing about a file but its path and its place: no content, selection or scroll', () => {
      const [saved] = saveWith(split(layout, PaneId.make('b'), 'right', fileView('README.md')), ['README.md']);
      expect(Object.keys(saved).sort()).toEqual(['layout', 'name', 'tabId', 'terminals']);
      expect(panesOf(saved.layout!).at(-1)?.views).toEqual([{ kind: 'file', path: 'README.md' }]);
    });

    it('still restores a layout saved before File Views were, with its Terminals only', () => {
      const pane = (id: string, view: unknown) => ({ kind: 'pane', pane: { id, views: [view], expanded: view } });
      const before = {
        projectId: 'p-timmy',
        lastNumber: 2,
        tabs: [
          {
            tabId: 't1',
            terminals: [{ terminalId: 'a', number: 1 }, { terminalId: 'b', number: 2 }],
            // The first Pane as layouts were saved before Views had kinds, the second as they were before File Views.
            layout: { root: { kind: 'split', direction: 'right', sizes: [0.5, 0.5], children: [pane('a', 'a'), pane('b', { kind: 'terminal', terminalId: 'b' })] }, focused: 'b' },
          },
        ],
      };
      const restored = restoredFrom([Schema.decodeUnknownSync(ProjectLayoutSchema)(before)]);
      expect(keys(restored.layouts.get(t1))).toEqual([['a'], ['b']]);
      expect(restored.layouts.get(t1)?.focused).toBe('b');
      expect(restored.entries.map((each) => each.id)).toEqual(['a', 'b']);
      expect(restored.pinned.size).toBe(0);
    });
  });

  it('restores every Terminal Idle, under its saved id, in its Tab, with its Provider', () => {
    const saved: ProjectLayout[] = [{ projectId: project, tabs: savedTabsOf(tabs, (tab) => layouts.get(tab.id), () => []), lastNumber: 5 }];
    const restored = restoredFrom(saved);
    expect(restored.entries).toEqual([
      { id: 'a', projectId: project, tabId: 't1', number: 1, name: 'claude 1', state: 'Idle', activity: 'Idle', provider: 'ClaudeCode' },
      { id: 'b', projectId: project, tabId: 't1', number: 2, name: 'shell 2', state: 'Idle', activity: 'Idle' },
      { id: 'c', projectId: project, tabId: 't2', number: 3, name: 'shell 3', state: 'Idle', activity: 'Idle' },
    ]);
    expect(restored.names).toEqual(new Map([[TabId.make('t1'), 'Work']]));
    expect(restored.layouts).toEqual(new Map([[TabId.make('t1'), layout]]));
    expect(restored.lastNumbers).toEqual(new Map([[project, 5]]));
  });

  it('gives a Terminal saved before Terminals had names its default name', () => {
    const restored = restoredFrom([
      { projectId: project, tabs: [{ tabId: TabId.make('t1'), terminals: [{ terminalId: TerminalId.make('a'), number: 2, provider: 'Codex' }, { terminalId: TerminalId.make('b'), number: 7 }] }], lastNumber: 7 },
    ]);
    expect(restored.entries.map((each) => each.name)).toEqual(['codex 2', 'shell 7']);
  });

  it('restores a layout whose focused Pane is gone onto its first Pane', () => {
    const broken = { ...layout, focused: PaneId.make('nowhere') };
    const restored = restoredFrom([{ projectId: project, tabs: [{ tabId: TabId.make('t1'), terminals: [{ terminalId: TerminalId.make('a'), number: 1 }, { terminalId: TerminalId.make('b'), number: 2 }], layout: broken }], lastNumber: 2 }]);
    expect(restored.layouts.get(TabId.make('t1'))?.focused).toBe(panesOf(layout)[0].id);
  });

  it('leaves a Tab saved without a layout to get the default one', () => {
    const restored = restoredFrom([{ projectId: project, tabs: [{ tabId: TabId.make('t1'), terminals: [{ terminalId: TerminalId.make('a'), number: 1 }] }], lastNumber: 1 }]);
    expect(restored.layouts.size).toBe(0);
  });

  it('skips a saved Tab with no Terminals: Timmy never keeps an empty Tab', () => {
    const restored = restoredFrom([{ projectId: project, tabs: [{ tabId: TabId.make('t1'), terminals: [] }], lastNumber: 0 }]);
    expect(restored.entries).toEqual([]);
  });
});
