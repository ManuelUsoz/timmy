import { TestBed } from '@angular/core/testing';
import { ProjectId } from '../../../shared/projects/projects.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { TerminalsState } from './terminals-state';

const timmy = ProjectId.make('p-timmy');

describe('TerminalsState', () => {
  it('starts without terminals', () => {
    expect(TestBed.inject(TerminalsState).entries()).toEqual([]);
  });

  it('creates an Idle terminal in the project, which can then be found', () => {
    const terminals = TestBed.inject(TerminalsState);
    const created = terminals.create(timmy);
    expect(created).toMatchObject({ projectId: timmy, number: 1, state: 'Idle', output: '' });
    expect(terminals.find(created.id)).toEqual(created);
    expect(terminals.entries()).toEqual([created]);
  });

  it('gives each new terminal its own id and the next number', () => {
    const terminals = TestBed.inject(TerminalsState);
    const first = terminals.create(timmy);
    const second = terminals.create(timmy);
    expect(second.id).not.toBe(first.id);
    expect(second.number).toBe(2);
  });

  it('lets the state of a terminal change, for the process that will drive it', () => {
    const terminals = TestBed.inject(TerminalsState);
    const created = terminals.create(timmy);
    terminals.setState(created.id, 'Error');
    expect(terminals.find(created.id)?.state).toBe('Error');
  });

  describe('the current terminal', () => {
    it('is nothing without terminals, and the newest one otherwise', () => {
      const terminals = TestBed.inject(TerminalsState);
      expect(terminals.current()).toBeUndefined();
      terminals.create(timmy);
      const second = terminals.create(timmy);
      expect(terminals.current()?.id).toBe(second.id);
    });

    it('follows the one picked, and ignores an id that is not a terminal', () => {
      const terminals = TestBed.inject(TerminalsState);
      const first = terminals.create(timmy);
      terminals.create(timmy);
      terminals.setCurrent(first.id);
      expect(terminals.current()?.id).toBe(first.id);
      terminals.setCurrent(TerminalId.make('nope'));
      expect(terminals.current()?.id).toBe(first.id);
    });
  });

  it('leaves no trace: no storage is written and a new run starts empty', () => {
    const before = localStorage.length;
    TestBed.inject(TerminalsState).create(timmy);
    expect(localStorage.length).toBe(before);
    TestBed.resetTestingModule();
    expect(TestBed.inject(TerminalsState).entries()).toEqual([]);
  });
});
