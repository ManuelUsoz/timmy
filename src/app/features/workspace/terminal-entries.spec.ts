import { ProjectId } from '../../../shared/projects/projects.model';
import { addTerminal, restarted, terminalsOf, withActivity, withExit, withState, TerminalId, type TerminalEntry } from './terminal-entries';

const timmy = ProjectId.make('p-timmy');
const ascua = ProjectId.make('p-ascua');
const id = (value: string) => TerminalId.make(value);

describe('terminal entries', () => {
  it('adds an Idle entry numbered after the last one of its project', () => {
    const first = addTerminal([], timmy, id('a'));
    const second = addTerminal(first, timmy, id('b'));
    expect(second.map((entry) => [entry.id, entry.number, entry.state])).toEqual([
      ['a', 1, 'Idle'],
      ['b', 2, 'Idle'],
    ]);
  });

  it('numbers each project on its own', () => {
    const entries = addTerminal(addTerminal([], timmy, id('a')), ascua, id('b'));
    expect(entries.find((entry) => entry.id === 'b')?.number).toBe(1);
  });

  it('lists the entries of one project, oldest first', () => {
    const entries = addTerminal(addTerminal(addTerminal([], timmy, id('a')), ascua, id('b')), timmy, id('c'));
    expect(terminalsOf(entries, timmy).map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(terminalsOf(entries, ascua).map((entry) => entry.id)).toEqual(['b']);
    expect(terminalsOf(entries, ProjectId.make('p-none'))).toEqual([]);
  });

  it('changes the state of one entry and leaves the rest as they were', () => {
    const entries = addTerminal(addTerminal([], timmy, id('a')), timmy, id('b'));
    const changed: ReadonlyArray<TerminalEntry> = withState(entries, id('b'), 'Error');
    expect(changed.map((entry) => entry.state)).toEqual(['Idle', 'Error']);
    expect(entries.map((entry) => entry.state)).toEqual(['Idle', 'Idle']);
  });

  it('ignores a state change for an entry that does not exist', () => {
    const entries = addTerminal([], timmy, id('a'));
    expect(withState(entries, id('nope'), 'Live')).toEqual(entries);
  });

  it('ends an entry as Done on a clean exit and as Error, keeping the code, on any other', () => {
    const entries = addTerminal(addTerminal([], timmy, id('a')), timmy, id('b'));
    const done = withExit(entries, id('a'), 0);
    const failed = withExit(entries, id('b'), 1);
    expect(done.find((entry) => entry.id === 'a')).toMatchObject({ state: 'Done', exitCode: 0 });
    expect(failed.find((entry) => entry.id === 'b')).toMatchObject({ state: 'Error', exitCode: 1 });
    expect(failed.find((entry) => entry.id === 'a')?.exitCode).toBeUndefined();
  });

  it('restarts an entry under a new id, keeping its project and number but not its output or exit code', () => {
    const entries = withExit(addTerminal(addTerminal([], timmy, id('a')), timmy, id('b')), id('b'), 1);
    const next = restarted(entries, id('b'), id('c'));
    expect(next.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(next[1]).toEqual({ id: 'c', projectId: timmy, number: 2, state: 'Live', activity: 'Idle', output: '' });
  });
});

describe('terminal activity', () => {
  it('starts Idle and takes the activity main reports for it', () => {
    const entries = addTerminal(addTerminal([], timmy, id('a')), timmy, id('b'));
    expect(entries.map((entry) => entry.activity)).toEqual(['Idle', 'Idle']);
    const next = withActivity(entries, [{ terminalId: id('b'), activity: 'NeedsAttention' }]);
    expect(next.map((entry) => entry.activity)).toEqual(['Idle', 'NeedsAttention']);
  });

  it('keeps the same entries when nothing changed, and ignores Terminals it does not know', () => {
    const entries = addTerminal([], timmy, id('a'));
    expect(withActivity(entries, [{ terminalId: id('a'), activity: 'Idle' }])[0]).toBe(entries[0]);
    expect(withActivity(entries, [{ terminalId: id('zzz'), activity: 'Active' }])).toEqual(entries);
  });
});
