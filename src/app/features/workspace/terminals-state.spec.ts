import { TestBed } from '@angular/core/testing';
import { Effect, Stream } from 'effect';
import { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { TerminalId, type TerminalActivityEntry } from '../../../shared/terminal/terminal.model';
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
    expect(created).toMatchObject({ projectId: timmy, number: 1, state: 'Idle' });
    expect(created.screen).toBeUndefined();
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

  it('keeps the screen a Terminal had when it left the window, to restore it where it is shown next', () => {
    const terminals = TestBed.inject(TerminalsState);
    const created = terminals.create(timmy);
    const screen = { cols: 120, rows: 34, data: 'PS C:\\demo> ' };
    terminals.saveScreen(created.id, screen);
    expect(terminals.find(created.id)?.screen).toEqual(screen);
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
const withMain = (activity: ReadonlyArray<ReadonlyArray<TerminalActivityEntry>> = []) => {
  const created: Array<{ readonly cwd: string; readonly provider?: Provider }> = [];
  const focused: TerminalId[] = [];
  const shown: Array<TerminalId | undefined> = [];
  const unused = () => Effect.die('not under test');
  const handlers = TerminalRpcs.toLayer({
    'Terminal.create': (payload) => Effect.sync(() => (created.push(payload), { terminalId: TerminalId.make(`t-${created.length}`) })),
    'Terminal.close': () => Effect.void,
    'Terminal.output': unused,
    'Terminal.activity': () => Stream.fromIterable(activity),
    'Terminal.focus': ({ terminalId }) => Effect.sync(() => void focused.push(terminalId)),
    'Terminal.write': unused,
    'Terminal.resize': unused,
    'Terminal.show': ({ terminalId }) => Effect.sync(() => void shown.push(terminalId)),
  });
  const layer = makeDesktopTestLayer(handlers);
  TestBed.configureTestingModule({
    providers: [{ provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } }],
  });
  return { created, focused, shown, terminals: TestBed.inject(TerminalsState) };
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

describe('TerminalsState: activity', () => {
  it('shows the activity main reports for a Terminal', async () => {
    const reported = [{ terminalId: TerminalId.make('t-1'), activity: 'NeedsAttention' as const }];
    const { terminals } = withMain([reported]);
    const opened = await terminals.createLive(timmy, '/work/timmy');
    await vi.waitFor(() => expect(terminals.find(opened!.id)?.activity).toBe('NeedsAttention'));
  });

  it('tells main when the user is on a Terminal', async () => {
    const { focused, terminals } = withMain();
    const opened = await terminals.createLive(timmy, '/work/timmy');
    await terminals.focus(opened!.id);
    expect(focused).toEqual([opened!.id]);
  });
});

describe('TerminalsState: the last lines of output', () => {
  it('has none for a Terminal no screen has shown', () => {
    const terminals = TestBed.inject(TerminalsState);
    expect(terminals.tailOf(terminals.create(timmy).id)).toEqual([]);
  });

  it('reads the screen showing the Terminal, as it is now', () => {
    const terminals = TestBed.inject(TerminalsState);
    const { id } = terminals.create(timmy);
    let lines = ['a', 'b'];
    terminals.attachTail(id, () => lines);
    expect(terminals.tailOf(id)).toEqual(['a', 'b']);
    lines = ['a', 'b', 'c', 'd', 'e', '', ''];
    expect(terminals.tailOf(id)).toEqual(['b', 'c', 'd', 'e']);
  });

  it('keeps the last lines the screen showed once it leaves', () => {
    const terminals = TestBed.inject(TerminalsState);
    const { id } = terminals.create(timmy);
    let lines = ['before'];
    const read = () => lines;
    terminals.attachTail(id, read);
    lines = ['npm test', 'ok'];
    terminals.detachTail(id, read);
    lines = ['changed after it left'];
    expect(terminals.tailOf(id)).toEqual(['npm test', 'ok']);
  });

  it('keeps reading the screen that took the Terminal over when the one it replaced leaves late', () => {
    const terminals = TestBed.inject(TerminalsState);
    const { id } = terminals.create(timmy);
    const old = () => ['old'];
    terminals.attachTail(id, old);
    let lines = ['new'];
    terminals.attachTail(id, () => lines);
    terminals.detachTail(id, old);
    lines = ['newer'];
    expect(terminals.tailOf(id)).toEqual(['newer']);
  });

  it('forgets the lines of a closed Terminal', async () => {
    const { terminals } = withMain();
    const opened = await terminals.createLive(timmy, '/work/timmy');
    const read = () => ['output'];
    terminals.attachTail(opened!.id, read);
    terminals.detachTail(opened!.id, read);
    terminals.attachTail(opened!.id, read);
    await terminals.close(opened!.id);
    expect(terminals.tailOf(opened!.id)).toEqual([]);
    // The screen leaves after the Terminal closed: what it held is not kept.
    terminals.detachTail(opened!.id, read);
    expect(terminals.tailOf(opened!.id)).toEqual([]);
  });

  it('starts a restarted Terminal with no lines', async () => {
    const { terminals } = withMain();
    const opened = await terminals.createLive(timmy, '/work/timmy');
    const read = () => ['old run'];
    terminals.attachTail(opened!.id, read);
    const restarted = await terminals.restart(opened!.id, '/work/timmy');
    terminals.detachTail(opened!.id, read);
    expect(terminals.tailOf(restarted!.id)).toEqual([]);
    expect(terminals.tailOf(opened!.id)).toEqual([]);
  });
});

describe('TerminalsState: what is showing', () => {
  it('tells main which Terminal the screen shows, and that none is once it leaves', async () => {
    const { shown, terminals } = withMain();
    const opened = await terminals.createLive(timmy, '/work/timmy');
    terminals.show(opened!.id);
    TestBed.tick();
    await vi.waitFor(() => expect(shown).toEqual([opened!.id]));
    terminals.hide(opened!.id);
    TestBed.tick();
    await vi.waitFor(() => expect(shown).toEqual([opened!.id, undefined]));
  });

  it('keeps the Terminal that took the screen over when the one it replaced leaves late', async () => {
    const { shown, terminals } = withMain();
    const first = await terminals.createLive(timmy, '/work/timmy');
    const second = await terminals.createLive(timmy, '/work/timmy');
    terminals.show(first!.id);
    terminals.show(second!.id);
    terminals.hide(first!.id);
    TestBed.tick();
    await vi.waitFor(() => expect(shown).toEqual([second!.id]));
  });
});
