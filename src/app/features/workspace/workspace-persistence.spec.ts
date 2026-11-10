import { TestBed } from '@angular/core/testing';
import { Effect, Layer, PubSub, Stream } from 'effect';
import { ProjectId } from '../../../shared/projects/projects.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { TerminalRpcs } from '../../../shared/terminal/terminal.rpc';
import { PaneId, TabId, type ProjectLayout, type SavedTab } from '../../../shared/workspace/workspace.model';
import { WorkspaceRpcs } from '../../../shared/workspace/workspace.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ToastService } from '../../core/toast';
import { TabsState } from './tabs-state';
import { TerminalsState } from './terminals-state';
import { terminalView, viewKey } from './views';
import { SAVE_AFTER_MS, WorkspacePersistence } from './workspace-persistence';

const timmy = ProjectId.make('p-timmy');
const ascua = ProjectId.make('p-ascua');

const savedTab = (id: string, terminals: ReadonlyArray<readonly [string, number]>, name?: string): SavedTab => ({
  tabId: TabId.make(id),
  ...(name === undefined ? {} : { name }),
  terminals: terminals.map(([terminalId, number]) => ({ terminalId: TerminalId.make(terminalId), number })),
});

/**
 * Main's saved layout in memory: what `Workspace.load` answers, and every `Workspace.save` it got. `quit()` is Timmy about
 * to quit; `calls` is what the window told main, in order: each save, and `saved`.
 */
const withStore = (initial: ReadonlyArray<ProjectLayout> = [], options: { loadFails?: boolean } = {}) => {
  const failSaves = { now: false };
  const saves: Array<{ readonly projectId: ProjectId; readonly tabs: ReadonlyArray<SavedTab>; readonly lastNumber: number }> = [];
  const calls: string[] = [];
  const quitting = Effect.runSync(PubSub.unbounded<'Quitting'>());
  let created = 0;
  const workspace = WorkspaceRpcs.toLayer({
    'Workspace.load': () => (options.loadFails ? Effect.die('the store is unreadable') : Effect.succeed(initial)),
    'Workspace.save': (payload) =>
      failSaves.now ? Effect.die('the disk is full') : Effect.sync(() => void (saves.push(payload), calls.push(`save ${payload.projectId}`))),
    'Workspace.renameTerminal': () => Effect.void,
    'Workspace.quitting': () => Stream.fromPubSub(quitting),
    'Workspace.saved': () => Effect.sync(() => void calls.push('saved')),
  });
  const quit = () => Effect.runSync(PubSub.publish(quitting, 'Quitting'));
  const terminal = TerminalRpcs.toLayer({
    'Terminal.create': () => Effect.sync(() => ({ terminalId: TerminalId.make(`live-${++created}`) })),
    'Terminal.close': () => Effect.void,
    'Terminal.output': () => Effect.die('unused'),
    'Terminal.activity': () => Effect.die('unused'),
    'Terminal.hookReports': () => Stream.empty,
    'Terminal.focus': () => Effect.void,
    'Terminal.write': () => Effect.void,
    'Terminal.resize': () => Effect.void,
    'Terminal.show': () => Effect.void,
  });
  const layer = makeDesktopTestLayer(Layer.mergeAll(workspace, terminal));
  TestBed.configureTestingModule({
    providers: [{ provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } }],
  });
  return { saves, calls, quit, failSaves, tabs: TestBed.inject(TabsState), terminals: TestBed.inject(TerminalsState), toasts: TestBed.inject(ToastService) };
};

/** Lets the pending RPCs answer, the effect run and the quiet moment pass. */
const settle = async () => {
  await vi.advanceTimersByTimeAsync(0);
  TestBed.tick();
  await vi.advanceTimersByTimeAsync(SAVE_AFTER_MS);
  await vi.advanceTimersByTimeAsync(0);
};

describe('WorkspacePersistence', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  const start = async () => {
    TestBed.inject(WorkspacePersistence);
    await settle();
  };

  it("brings back each Project's Tabs, their names and layout, and their Terminals Idle", async () => {
    const layout = {
      root: { kind: 'pane' as const, pane: { id: PaneId.make('a'), views: [terminalView(TerminalId.make('a'))], expanded: terminalView(TerminalId.make('a')) } },
      focused: PaneId.make('a'),
    };
    const { tabs, terminals } = withStore([{ projectId: timmy, tabs: [{ ...savedTab('t1', [['a', 1]], 'Work'), layout }, savedTab('t2', [['b', 2]])], lastNumber: 2 }]);
    await start();
    expect(tabs.tabsOf(timmy).map((tab) => [tab.id, tab.name, tab.terminals.map((entry) => [entry.id, entry.state])])).toEqual([
      ['t1', 'Work', [['a', 'Idle']]],
      ['t2', undefined, [['b', 'Idle']]],
    ]);
    expect(tabs.layoutOf(tabs.tabsOf(timmy)[0])).toEqual(layout);
    expect(terminals.entries()).toHaveLength(2);
  });

  it('writes nothing back when the layout is just restored', async () => {
    const { saves } = withStore([{ projectId: timmy, tabs: [savedTab('t1', [['a', 1]])], lastNumber: 1 }]);
    await start();
    expect(saves).toEqual([]);
  });

  it("saves a Project's Tabs once they change, and only that Project's", async () => {
    const { saves, terminals, tabs } = withStore([{ projectId: ascua, tabs: [savedTab('t9', [['z', 1]])], lastNumber: 1 }]);
    await start();
    const opened = (await terminals.createLive(timmy, '/work/timmy', 'ClaudeCode'))!;
    await settle();
    expect(saves).toHaveLength(1);
    expect(saves[0].projectId).toBe(timmy);
    expect(saves[0].tabs).toMatchObject([{ tabId: opened.tabId, terminals: [{ terminalId: opened.id, number: 1, name: 'claude 1', provider: 'ClaudeCode' }] }]);
    tabs.rename(opened.tabId, 'Review');
    await settle();
    expect(saves.at(-1)?.tabs).toMatchObject([{ name: 'Review' }]);
  });

  it("saves a Tab's layout when a Pane is added to it", async () => {
    const { saves, terminals, tabs } = withStore();
    await start();
    const first = (await terminals.createLive(timmy, '/work/timmy'))!;
    await settle();
    await tabs.openInTab(tabs.tabsOf(timmy)[0], '/work/timmy', undefined, (layout, view) => ({ ...layout, focused: PaneId.make(viewKey(view)) }));
    await settle();
    expect(saves.at(-1)?.tabs[0].terminals).toHaveLength(2);
    expect(saves.at(-1)?.tabs[0].terminals[0].terminalId).toBe(first.id);
    expect(saves.at(-1)?.tabs[0].layout?.focused).toBe(saves.at(-1)?.tabs[0].terminals[1].terminalId);
  });

  it('saves the Project with no Tabs once its last Terminal closes, so the store forgets them', async () => {
    const { saves, terminals } = withStore();
    await start();
    const opened = (await terminals.createLive(timmy, '/work/timmy'))!;
    await settle();
    await terminals.close(opened.id);
    await settle();
    // Its number stays given: the next Terminal of the Project is not #1 again.
    expect(saves.at(-1)).toEqual({ projectId: timmy, tabs: [], lastNumber: 1 });
  });

  it("does not save what is not part of the layout: a Terminal's exit", async () => {
    const { saves, terminals } = withStore();
    await start();
    const opened = (await terminals.createLive(timmy, '/work/timmy'))!;
    await settle();
    const before = saves.length;
    terminals.exited(opened.id, 1);
    await settle();
    expect(saves).toHaveLength(before);
  });

  it('saves nothing, and says so, when the saved layout could not be loaded: an empty Workspace must not replace it', async () => {
    const { saves, terminals, toasts } = withStore([], { loadFails: true });
    await start();
    await terminals.createLive(timmy, '/work/timmy');
    await settle();
    expect(saves).toEqual([]);
    expect(toasts.toasts().map((toast) => toast.body)).toEqual(['workspace.loadFailed']);
  });

  it('keeps a Terminal opened before the load finished as a change to save, in a Project that already had Tabs', async () => {
    const { saves, terminals } = withStore([{ projectId: timmy, tabs: [savedTab('t1', [['a', 1]])], lastNumber: 1 }]);
    TestBed.inject(WorkspacePersistence);
    const early = terminals.create(timmy);
    await settle();
    expect(saves.at(-1)?.tabs.flatMap((tab) => tab.terminals.map((terminal) => terminal.terminalId))).toHaveLength(2);
    expect(saves.at(-1)?.tabs.flatMap((tab) => tab.terminals.map((terminal) => terminal.terminalId))).toContain(early.id);
  });

  it('saves a Project again at its next change when a save failed', async () => {
    const { saves, terminals, failSaves } = withStore();
    await start();
    failSaves.now = true;
    await terminals.createLive(timmy, '/work/timmy');
    await settle();
    failSaves.now = false;
    await terminals.createLive(timmy, '/work/timmy');
    await settle();
    expect(saves.at(-1)?.tabs).toHaveLength(2);
  });

  it('numbers a new Terminal after the highest number its Project gave before the restart, closed ones included', async () => {
    const { saves, terminals } = withStore([{ projectId: timmy, tabs: [savedTab('t1', [['a', 2]])], lastNumber: 7 }]);
    await start();
    const opened = (await terminals.createLive(timmy, '/work/timmy', 'Codex'))!;
    expect(opened).toMatchObject({ number: 8, name: 'codex 8' });
    await settle();
    expect(saves.at(-1)?.lastNumber).toBe(8);
  });

  it('restores a Terminal saved before Terminals had names with its default name, and saves it under that name', async () => {
    const { saves, terminals } = withStore([{ projectId: timmy, tabs: [savedTab('t1', [['a', 3]])], lastNumber: 3 }]);
    await start();
    expect(terminals.find(TerminalId.make('a'))?.name).toBe('shell 3');
    await terminals.createLive(timmy, '/work/timmy');
    await settle();
    expect(saves.at(-1)?.tabs[0].terminals[0]).toEqual({ terminalId: 'a', number: 3, name: 'shell 3' });
  });

  it('saves a Terminal renamed by the user under its new name', async () => {
    const { saves, terminals } = withStore();
    await start();
    const opened = (await terminals.createLive(timmy, '/work/timmy'))!;
    await settle();
    await terminals.rename(opened.id, 'deploy');
    await settle();
    expect(saves.at(-1)?.tabs[0].terminals[0].name).toBe('deploy');
  });

  it('saves a change made just before Timmy quits, then tells main it may quit', async () => {
    const { calls, quit, terminals } = withStore();
    await start();
    await terminals.createLive(timmy, '/work/timmy');
    // No quiet moment passes: the save is still waiting when Timmy quits.
    quit();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([`save ${timmy}`, 'saved']);
  });

  it('answers only once a save already on its way and the last change are both in', async () => {
    const { calls, quit, terminals, tabs } = withStore();
    await start();
    const opened = (await terminals.createLive(timmy, '/work/timmy'))!;
    await settle();
    tabs.rename(opened.tabId, 'Review');
    quit();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual([`save ${timmy}`, `save ${timmy}`, 'saved']);
  });

  it('tells main at once that it may quit when there is nothing to save', async () => {
    const { calls, quit } = withStore([], { loadFails: true });
    await start();
    quit();
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toEqual(['saved']);
  });

  it('batches the changes of a quiet moment into one save per Project', async () => {
    const { saves, terminals } = withStore();
    await start();
    await terminals.createLive(timmy, '/work/timmy');
    await terminals.createLive(timmy, '/work/timmy');
    await settle();
    expect(saves).toHaveLength(1);
    expect(saves[0].tabs).toHaveLength(2);
  });
});
