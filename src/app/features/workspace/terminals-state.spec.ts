import { TestBed } from '@angular/core/testing';
import { Effect } from 'effect';
import { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { TerminalRpcs } from '../../../shared/terminal/terminal.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
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

/** The real client against a main whose Terminal.create answers a new id each time and records what it was asked. */
const withMain = () => {
  const created: Array<{ readonly cwd: string; readonly provider?: Provider }> = [];
  const unused = () => Effect.die('not under test');
  const handlers = TerminalRpcs.toLayer({
    'Terminal.create': (payload) => Effect.sync(() => (created.push(payload), { terminalId: TerminalId.make(`t-${created.length}`) })),
    'Terminal.close': () => Effect.void,
    'Terminal.output': unused,
    'Terminal.write': unused,
    'Terminal.resize': unused,
  });
  const layer = makeDesktopTestLayer(handlers);
  TestBed.configureTestingModule({
    providers: [{ provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } }],
  });
  return { created, terminals: TestBed.inject(TerminalsState) };
};

describe('TerminalsState: Providers', () => {
  it('asks main for the Provider the Terminal is opened with, and for none otherwise', async () => {
    const { created, terminals } = withMain();
    await terminals.createLive(timmy, '/work/timmy', 'Codex');
    await terminals.createLive(timmy, '/work/timmy');
    expect(created).toEqual([{ cwd: '/work/timmy', provider: 'Codex' }, { cwd: '/work/timmy' }]);
  });

  it('restarts a Provider Terminal with the same Provider', async () => {
    const { created, terminals } = withMain();
    const opened = await terminals.createLive(timmy, '/work/timmy', 'ClaudeCode');
    const restarted = await terminals.restart(opened!.id, '/work/timmy');
    expect(created.at(-1)).toEqual({ cwd: '/work/timmy', provider: 'ClaudeCode' });
    expect(restarted).toMatchObject({ number: 1, provider: 'ClaudeCode' });
  });

  it('restarts a plain shell as a plain shell', async () => {
    const { created, terminals } = withMain();
    const opened = await terminals.createLive(timmy, '/work/timmy');
    await terminals.restart(opened!.id, '/work/timmy');
    expect(created.at(-1)).toEqual({ cwd: '/work/timmy' });
  });
});
