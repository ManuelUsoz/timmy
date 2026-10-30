import { ProjectId } from '../../../shared/sessions/sessions.model';
import { addTerminal, terminalsOf, withState, TerminalId, type TerminalEntry } from './terminal-entries';

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
});
