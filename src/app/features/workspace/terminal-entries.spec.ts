import { ProjectId } from '../../../shared/projects/projects.model';
import { addTerminal, restarted, terminalsOf, withActivity, withExit, withName, withScreen, withState, TerminalId, type TerminalEntry } from './terminal-entries';
import { TabId } from './tabs';

const timmy = ProjectId.make('p-timmy');
const ascua = ProjectId.make('p-ascua');
const id = (value: string) => TerminalId.make(value);
const tab = TabId.make('t');
const screen = { cols: 120, rows: 34, data: 'PS C:\\demo> ' };

describe('terminal entries', () => {
  it('adds an Idle entry numbered after the last one of its project', () => {
    const first = addTerminal([], timmy, tab, id('a'));
    const second = addTerminal(first, timmy, tab, id('b'));
    expect(second.map((entry) => [entry.id, entry.number, entry.state])).toEqual([
      ['a', 1, 'Idle'],
      ['b', 2, 'Idle'],
    ]);
  });

  it('names a new Terminal after its Provider and number, a plain shell "shell"', () => {
    const entries = addTerminal(addTerminal([], timmy, tab, id('a'), 'ClaudeCode'), timmy, tab, id('b'));
    expect(entries.map((entry) => entry.name)).toEqual(['claude 1', 'shell 2']);
  });

  it('numbers after the highest number the Project has given, even one whose Terminal is closed', () => {
    const entries = addTerminal([], timmy, tab, id('a'), 'Codex', 7);
    expect(entries[0]).toMatchObject({ number: 8, name: 'codex 8' });
  });

  it('keeps a default name unique when the user already gave it to another Terminal', () => {
    const renamed = withName(addTerminal([], timmy, tab, id('a')), id('a'), 'Shell 2');
    expect(addTerminal(renamed, timmy, tab, id('b')).at(-1)?.name).toBe('shell 2 (2)');
  });

  it('numbers each project on its own', () => {
    const entries = addTerminal(addTerminal([], timmy, tab, id('a')), ascua, tab, id('b'));
    expect(entries.find((entry) => entry.id === 'b')?.number).toBe(1);
  });

  it('lists the entries of one project, oldest first', () => {
    const entries = addTerminal(addTerminal(addTerminal([], timmy, tab, id('a')), ascua, tab, id('b')), timmy, tab, id('c'));
    expect(terminalsOf(entries, timmy).map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(terminalsOf(entries, ascua).map((entry) => entry.id)).toEqual(['b']);
    expect(terminalsOf(entries, ProjectId.make('p-none'))).toEqual([]);
  });

  it('changes the state of one entry and leaves the rest as they were', () => {
    const entries = addTerminal(addTerminal([], timmy, tab, id('a')), timmy, tab, id('b'));
    const changed: ReadonlyArray<TerminalEntry> = withState(entries, id('b'), 'Error');
    expect(changed.map((entry) => entry.state)).toEqual(['Idle', 'Error']);
    expect(entries.map((entry) => entry.state)).toEqual(['Idle', 'Idle']);
  });

  it('ignores a state change for an entry that does not exist', () => {
    const entries = addTerminal([], timmy, tab, id('a'));
    expect(withState(entries, id('nope'), 'Live')).toEqual(entries);
  });

  it('ends an entry as Done on a clean exit and as Error, keeping the code, on any other', () => {
    const entries = addTerminal(addTerminal([], timmy, tab, id('a')), timmy, tab, id('b'));
    const done = withExit(entries, id('a'), 0);
    const failed = withExit(entries, id('b'), 1);
    expect(done.find((entry) => entry.id === 'a')).toMatchObject({ state: 'Done', exitCode: 0 });
    expect(failed.find((entry) => entry.id === 'b')).toMatchObject({ state: 'Error', exitCode: 1 });
    expect(failed.find((entry) => entry.id === 'a')?.exitCode).toBeUndefined();
  });

  it('keeps the screen of one entry, at the size it was recorded, and leaves the rest as they were', () => {
    const entries = addTerminal(addTerminal([], timmy, tab, id('a')), timmy, tab, id('b'));
    const next = withScreen(entries, id('b'), screen);
    expect(next.map((entry) => entry.screen)).toEqual([undefined, screen]);
    expect(entries.map((entry) => entry.screen)).toEqual([undefined, undefined]);
  });

  it('restarts an entry under a new id, keeping its project, Tab, number and name but not its screen or exit code', () => {
    const entries = withName(withScreen(withExit(addTerminal(addTerminal([], timmy, tab, id('a')), timmy, tab, id('b')), id('b'), 1), id('b'), screen), id('b'), 'build');
    const next = restarted(entries, id('b'), id('c'));
    expect(next.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(next[1]).toEqual({ id: 'c', projectId: timmy, tabId: tab, number: 2, name: 'build', state: 'Live', activity: 'Idle' });
  });
});

describe('terminal activity', () => {
  it('starts Idle and takes the activity main reports for it', () => {
    const entries = addTerminal(addTerminal([], timmy, tab, id('a')), timmy, tab, id('b'));
    expect(entries.map((entry) => entry.activity)).toEqual(['Idle', 'Idle']);
    const next = withActivity(entries, [{ terminalId: id('b'), activity: 'NeedsAttention' }]);
    expect(next.map((entry) => entry.activity)).toEqual(['Idle', 'NeedsAttention']);
  });

  it('keeps the same entries when nothing changed, and ignores Terminals it does not know', () => {
    const entries = addTerminal([], timmy, tab, id('a'));
    expect(withActivity(entries, [{ terminalId: id('a'), activity: 'Idle' }])[0]).toBe(entries[0]);
    expect(withActivity(entries, [{ terminalId: id('zzz'), activity: 'Active' }])).toEqual(entries);
  });
});
