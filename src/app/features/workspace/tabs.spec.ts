import { ProjectId } from '../../../shared/projects/projects.model';
import { PaneId, addToStack, focusPane, showView, singlePane, split } from './pane-layout';
import { TerminalId, type TerminalEntry } from './terminal-entries';
import { TabId, closeNeedsConfirm, neighbourOf, tabDot, tabPath, tabsOf } from './tabs';
import { terminalView } from './views';

const timmy = ProjectId.make('p-timmy');
const ascua = ProjectId.make('p-ascua');

const terminal = (id: string, tab: string, projectId = timmy, number = 1): TerminalEntry => ({
  id: TerminalId.make(id),
  projectId,
  tabId: TabId.make(tab),
  number,
  name: id,
  state: 'Live',
  activity: 'Idle',
});

describe('Tabs', () => {
  describe('tabsOf', () => {
    it('groups the Project\'s Terminals by Tab, in the order the Tabs were opened', () => {
      const tabs = tabsOf([terminal('a', 't1'), terminal('b', 't2', ascua), terminal('c', 't3'), terminal('d', 't1')], timmy, new Map());
      expect(tabs.map((tab) => [tab.id, tab.terminals.map((entry) => entry.id)])).toEqual([
        ['t1', ['a', 'd']],
        ['t3', ['c']],
      ]);
    });

    it('has no Tabs for a Project without Terminals: a Tab never outlives its Terminals', () => {
      expect(tabsOf([terminal('b', 't2', ascua)], timmy, new Map())).toEqual([]);
    });

    it('carries the name the user gave a Tab, and none for a Tab named after its first Terminal', () => {
      const tabs = tabsOf([terminal('a', 't1'), terminal('c', 't3')], timmy, new Map([[TabId.make('t3'), 'review']]));
      expect(tabs.map((tab) => tab.name)).toEqual([undefined, 'review']);
    });
  });

  describe('tabDot', () => {
    it('shows nothing while no Terminal is Waiting or Error', () => {
      expect(tabDot([])).toBeUndefined();
      expect(tabDot(['Working', 'Done', 'Idle'])).toBeUndefined();
    });

    it('shows Waiting or Error, Waiting first', () => {
      expect(tabDot(['Working', 'Error'])).toBe('Error');
      expect(tabDot(['Error', 'Waiting', 'Done'])).toBe('Waiting');
    });
  });

  describe('tabPath', () => {
    it('shows a Tab at its first Terminal\'s route', () => {
      const [tab] = tabsOf([terminal('a', 't1'), terminal('d', 't1')], timmy, new Map());
      expect(tabPath(tab)).toEqual(['/projects', 'p-timmy', 'terminals', 'a']);
    });

    it('shows a Tab with a layout at its focused Pane\'s expanded View', () => {
      const [tab] = tabsOf([terminal('a', 't1'), terminal('d', 't1'), terminal('e', 't1')], timmy, new Map());
      const layout = addToStack(split(singlePane(terminalView(TerminalId.make('a'))), PaneId.make('a'), 'right', terminalView(TerminalId.make('d'))), PaneId.make('d'), terminalView(TerminalId.make('e')));
      expect(tabPath(tab, showView(layout, PaneId.make('d'), 0))).toEqual(['/projects', 'p-timmy', 'terminals', 'd']);
      expect(tabPath(tab, focusPane(layout, PaneId.make('a')))).toEqual(['/projects', 'p-timmy', 'terminals', 'a']);
    });
  });

  describe('neighbourOf', () => {
    const tabs = tabsOf([terminal('a', 't1'), terminal('b', 't2'), terminal('c', 't3')], timmy, new Map());
    it('is the Tab after the closed one, else the one before, else none', () => {
      expect(neighbourOf(tabs, TabId.make('t2'))?.id).toBe('t3');
      expect(neighbourOf(tabs, TabId.make('t3'))?.id).toBe('t2');
      expect(neighbourOf(tabs.slice(0, 1), TabId.make('t1'))).toBeUndefined();
    });
  });

  describe('closeNeedsConfirm', () => {
    it('asks only while a Terminal is Working or Waiting', () => {
      expect(closeNeedsConfirm(['Idle', 'Done', 'Error'])).toBe(false);
      expect(closeNeedsConfirm(['Done', 'Working'])).toBe(true);
      expect(closeNeedsConfirm(['Waiting'])).toBe(true);
    });
  });
});
