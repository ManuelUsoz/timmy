import { TestBed } from '@angular/core/testing';
import { Effect, Layer, PubSub, Stream } from 'effect';
import type { HookSignal } from '../../../shared/hooks/hooks.model';
import type { TerminalHookReport, TerminalId } from '../../../shared/terminal/terminal.model';
import { TerminalRpcs } from '../../../shared/terminal/terminal.rpc';
import type { TreeNode } from '../../shared/ui/tree-view/tree-view.types';
import { makeDesktopTestLayer, terminalUnusedHandlers } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { CHANGES_DEBOUNCE_MS, FilesBrowser } from './files-browser';
import { change, file, folder, text, type FakeDisk, type FakeFiles } from './files-fakes';
import { fakeRuntime, layerFakeBackend, makeBackend, project } from './projects-fakes';
import { PaneId, addToStack, focusPane, panesOf, showView, type TabLayout } from './pane-layout';
import { ProjectsState } from './projects-state';
import type { Tab } from './tabs';
import { TabsState } from './tabs-state';
import { TerminalsState } from './terminals-state';
import { fileView, viewKey } from './views';
import { WorkspaceLayoutState } from './workspace-layout';

const timmy = project('timmy');
const ascua = project('ascua');

const timmyDisk = (): FakeDisk => ({
  dirs: {
    '': [folder('node_modules', true), folder('src'), file('.env', true), file('README.md')],
    src: [folder('app'), file('main.ts')],
    'src/app': [file('a.ts')],
    node_modules: [folder('pkg', true), file('.package-lock.json', true)],
  },
  files: {
    'README.md': text('# timmy\n'),
    'src/main.ts': text('main\n'),
    'src/app/a.ts': text('a\n'),
    'logo.png': { kind: 'binary' },
    'big.log': { kind: 'tooLarge', size: 2_000_000 },
  },
  index: ['README.md', 'src/main.ts', 'src/app/a.ts'],
});

/** How long the browser waits for a burst of refresh triggers to end, in these tests. */
const DEBOUNCE = 20;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const setup = async (initial: { readonly files?: Partial<FakeFiles> } = {}) => {
  const backend = makeBackend({
    projects: [timmy, ascua],
    files: {
      disks: { [timmy.cwd]: timmyDisk(), [ascua.cwd]: { dirs: { '': [file('LICENSE')] }, files: {}, index: ['LICENSE'] } },
      ...initial.files,
    } as FakeFiles,
  });
  /** What the Hooks of every Terminal report, as main passes them on. */
  const hooks = Effect.runSync(PubSub.unbounded<TerminalHookReport>());
  const layer = makeDesktopTestLayer(
    Layer.mergeAll(
      layerFakeBackend(backend),
      TerminalRpcs.toLayer({ ...terminalUnusedHandlers, 'Terminal.hookReports': () => Stream.fromPubSub(hooks) }),
    ),
  );
  const runtime = { run: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(effect as never, layer)) };
  TestBed.configureTestingModule({
    providers: [
      { provide: EffectRuntime, useValue: runtime },
      { provide: CHANGES_DEBOUNCE_MS, useValue: DEBOUNCE },
    ],
  });
  const projects = TestBed.inject(ProjectsState);
  await projects.refresh();
  projects.select(timmy.projectId);
  const browser = TestBed.inject(FilesBrowser);
  /** Lets the effects run and the fake main answer. */
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      TestBed.tick();
      await new Promise((resolve) => setTimeout(resolve));
    }
  };
  const nodes = (): readonly TreeNode[] => {
    const tree = browser.tree();
    return tree.status === 'ready' ? tree.nodes : [];
  };
  /** The tree as indented labels, so a test reads like the screen. */
  const outline = (list: readonly TreeNode[] = nodes(), depth = 0): string[] =>
    list.flatMap((node) => [`${'  '.repeat(depth)}${node.label}`, ...outline(node.children ?? [], depth + 1)]);
  const listDirs = () => backend.files.calls.filter((call) => call.startsWith('Files.listDir:'));
  /** The tree as indented labels with each row's mark, and `~` before a struck-through row. */
  const marked = (list: readonly TreeNode[] = nodes(), depth = 0): string[] =>
    list.flatMap((node) => [
      `${'  '.repeat(depth)}${node.struck ? '~' : ''}${node.label}${node.flag ? ` [${node.flag.text}]` : ''}`,
      ...marked(node.children ?? [], depth + 1),
    ]);
  /** A Provider's Hook reports about a Terminal. */
  const report = (terminalId: TerminalId, signal: HookSignal) => Effect.runSync(PubSub.publish(hooks, { terminalId, signal }));
  /** Waits out the debounce, then lets the answer arrive. */
  const settleChanges = async () => {
    await wait(DEBOUNCE * 3);
    await settle();
  };
  const changesCalls = () => backend.files.calls.filter((call) => call === 'Files.changes').length;
  return { backend, projects, browser, settle, nodes, outline, listDirs, marked, report, settleChanges, changesCalls };
};

describe('FilesBrowser tree', () => {
  it('opens on the root of the Project alone: folders first, ignored ones dimmed, nothing deeper read', async () => {
    const { browser, settle, nodes, listDirs } = await setup();
    expect(browser.open()).toBe(false);
    browser.toggle();
    await settle();
    expect(browser.open()).toBe(true);
    expect(nodes().map((node) => [node.label, node.kind, node.dimmed ?? false])).toEqual([
      ['node_modules', 'folder', true],
      ['src', 'folder', false],
      ['.env', 'file', true],
      ['README.md', 'file', false],
    ]);
    expect(listDirs()).toEqual(['Files.listDir:']);
  });

  it('reads a folder when it is opened, once, and not again when it is closed and reopened', async () => {
    const { browser, settle, outline, listDirs } = await setup();
    browser.toggle();
    await settle();
    browser.setFolderOpen('src', true);
    await settle();
    expect(outline()).toEqual(['node_modules', 'src', '  app', '  main.ts', '.env', 'README.md']);
    browser.setFolderOpen('src', false);
    browser.setFolderOpen('src', true);
    await settle();
    expect(listDirs()).toEqual(['Files.listDir:', 'Files.listDir:src']);
  });

  it('opens a folder that is ignored only when asked', async () => {
    const { browser, settle, outline, listDirs } = await setup();
    browser.toggle();
    await settle();
    expect(listDirs()).not.toContain('Files.listDir:node_modules');
    browser.setFolderOpen('node_modules', true);
    await settle();
    expect(outline().slice(0, 4)).toEqual(['node_modules', '  pkg', '  .package-lock.json', 'src']);
  });

  it('remembers the open folders for the Project', async () => {
    const { backend, browser, settle } = await setup();
    browser.toggle();
    await settle();
    browser.setFolderOpen('src', true);
    browser.setFolderOpen('src/app', true);
    await settle();
    expect(backend.files.saved[timmy.projectId]).toEqual({ expanded: ['src', 'src/app'], lastFile: null });
  });

  it('opens again on the folders it remembered, reading each of them', async () => {
    const { browser, settle, outline, listDirs } = await setup({
      files: { saved: { [timmy.projectId]: { expanded: ['src', 'src/app'], lastFile: null } } },
    });
    browser.toggle();
    await settle();
    expect(outline()).toEqual(['node_modules', 'src', '  app', '    a.ts', '  main.ts', '.env', 'README.md']);
    expect([...listDirs()].sort()).toEqual(['Files.listDir:', 'Files.listDir:src', 'Files.listDir:src/app']);
  });

  it('forgets a remembered folder that is gone instead of showing it as broken', async () => {
    const { backend, browser, settle, outline } = await setup({
      files: { saved: { [timmy.projectId]: { expanded: ['src', 'deleted'], lastFile: null } } },
    });
    browser.toggle();
    await settle();
    expect(outline()).toEqual(['node_modules', 'src', '  app', '  main.ts', '.env', 'README.md']);
    expect(backend.files.saved[timmy.projectId]?.expanded).toEqual(['src']);
  });

  it('says a folder could not be read, instead of showing it empty', async () => {
    const { browser, settle, nodes } = await setup({ files: { broken: new Set(['src']) } });
    browser.toggle();
    await settle();
    browser.setFolderOpen('src', true);
    await settle();
    const children = nodes().find((node) => node.id === 'src')?.children ?? [];
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ disabled: true });
    expect(children[0].label).toContain('the disk is unreadable');
  });

  it('shows the root as failed, not as an empty Project, when it cannot be read', async () => {
    const { browser, settle } = await setup({ files: { broken: new Set(['']) } });
    browser.toggle();
    await settle();
    expect(browser.tree()).toMatchObject({ status: 'failed' });
  });

  it('keeps an empty Project apart from one that is loading or failed', async () => {
    const backend = { dirs: { '': [] }, files: {}, index: [] } satisfies FakeDisk;
    const { browser, settle } = await setup({ files: { disks: { [timmy.cwd]: backend } } });
    browser.toggle();
    expect(browser.tree().status).toBe('loading');
    await settle();
    expect(browser.tree()).toEqual({ status: 'ready', nodes: [] });
  });
});


describe('FilesBrowser opens a File View', () => {
  /** The browser open on timmy, with one Tab of one Terminal on screen. */
  const opened = async (initial: Parameters<typeof setup>[0] = {}) => {
    const context = await setup(initial);
    const tabs = TestBed.inject(TabsState);
    const terminals = TestBed.inject(TerminalsState);
    const first = terminals.create(timmy.projectId);
    terminals.setCurrent(first.id);
    context.browser.toggle();
    await context.settle();
    const tab = (): Tab => tabs.tabsOf(timmy.projectId).find((each) => each.id === first.tabId) as Tab;
    const layout = (): TabLayout => tabs.layoutOf(tab()) as TabLayout;
    /** Each Pane as the keys of its Views, left to right, its expanded View first; the focused Pane starred. */
    const panes = () =>
      panesOf(layout()).map((pane) => {
        const views = [pane.expanded, ...pane.views.filter((view) => viewKey(view) !== viewKey(pane.expanded))];
        return `${pane.id === layout().focused ? '*' : ''}${views.map(viewKey).join(' ')}`;
      });
    const files = () => tabs.filesOf(tab()).map((open) => `${open.path}${open.pinned ? ' (pinned)' : ''}`);
    return { ...context, tabs, terminals, first, tab, layout, panes, files };
  };

  it('opens a click as a preview File View in a Pane to the right of the focused one, which takes the focus', async () => {
    const { browser, first, panes, files } = await opened();
    browser.pick('README.md');
    expect(files()).toEqual(['README.md']);
    expect(panes()).toEqual([first.id, '*file:README.md']);
    expect(browser.selected()).toBe('README.md');
  });
  it('replaces the preview with the next file clicked, in its place, wherever it was moved', async () => {
    const { browser, tabs, tab, first, panes, files } = await opened();
    browser.pick('README.md');
    // The user moves the preview into the Terminal's Stack.
    tabs.update(tab(), (layout) => addToStack(layout, PaneId.make(first.id), fileView('README.md')));
    expect(panes()).toEqual([`*file:README.md ${first.id}`]);
    tabs.update(tab(), (layout) => showView(layout, PaneId.make(first.id), 0));
    browser.openFile('src/main.ts');
    expect(files()).toEqual(['src/main.ts']);
    expect(panes()).toEqual([`*file:src/main.ts ${first.id}`]);
  });

  it('opens a double click pinned, and the next click as a new preview beside it', async () => {
    const { browser, first, panes, files } = await opened();
    browser.pick('README.md', true);
    expect(files()).toEqual(['README.md (pinned)']);
    browser.openFile('src/main.ts');
    expect(files()).toEqual(['README.md (pinned)', 'src/main.ts']);
    expect(panes()).toEqual([first.id, 'file:README.md', '*file:src/main.ts']);
  });

  it('pins the preview with a double click on its row, keeping it where it is', async () => {
    const { browser, first, panes, files } = await opened();
    browser.pick('README.md');
    browser.pick('README.md', true);
    expect(files()).toEqual(['README.md (pinned)']);
    expect(panes()).toEqual([first.id, '*file:README.md']);
  });

  it('keeps a pinned File View when the next file is clicked: the pin button made it stay', async () => {
    const { browser, tabs, tab, files } = await opened();
    browser.pick('README.md');
    tabs.pinFile(tab(), 'README.md');
    browser.openFile('src/main.ts');
    browser.openFile('src/app/a.ts');
    expect(files()).toEqual(['README.md (pinned)', 'src/app/a.ts']);
  });

  it('focuses a file already open in the Tab instead of opening it twice', async () => {
    const { browser, tabs, tab, first, panes, files } = await opened();
    browser.pick('README.md', true);
    browser.openFile('src/main.ts');
    tabs.update(tab(), (layout) => focusPane(layout, PaneId.make(first.id)));
    browser.openFile('README.md');
    expect(files()).toEqual(['README.md (pinned)', 'src/main.ts']);
    expect(panes()).toEqual([first.id, '*file:README.md', 'file:src/main.ts']);
    expect(tabs.focusRequest()).toEqual({ tab: first.tabId, view: fileView('README.md') });
  });

  it('opens like a new Terminal at 6 Panes: in a Stack with room', async () => {
    const { browser, terminals, panes, first } = await opened();
    for (let n = 0; n < 4; n++) terminals.create(timmy.projectId, first.tabId);
    browser.pick('README.md', true);
    expect(panes()).toHaveLength(6);
    browser.openFile('src/main.ts');
    expect(panes()).toHaveLength(6);
    expect(panes().filter((pane) => pane.startsWith('*'))).toEqual([expect.stringMatching(/^\*file:src\/main\.ts /)]);
  });

  it('opens a filter match as a File View too, and nothing for a folder or a row that is not an entry', async () => {
    const { browser, settle, files } = await opened();
    browser.setFolderOpen('src', true);
    await settle();
    browser.pick('src');
    browser.pick('src/\u0000loading');
    browser.pick('nope.ts');
    expect(files()).toEqual([]);
    browser.filter.set('main');
    browser.openFile('src/main.ts');
    expect(files()).toEqual(['src/main.ts']);
  });

  it('only highlights the file when no Tab of the Project is on screen: a Tab needs a Terminal', async () => {
    const { browser, tabs, terminals, first } = await opened();
    await terminals.close(first.id);
    browser.pick('README.md');
    expect(browser.selected()).toBe('README.md');
    expect(tabs.tabsOf(timmy.projectId)).toEqual([]);
  });

  it('remembers the file picked as the tree highlight only, never as a reader', async () => {
    const { backend, browser, settle } = await opened();
    browser.pick('README.md');
    await settle();
    expect(backend.files.saved[timmy.projectId]).toEqual({ expanded: [], lastFile: 'README.md' });
    expect(backend.files.calls.filter((call) => call.startsWith('Files.read:'))).toEqual([]);
  });

  it('closes the Tab with its File Views, pinned ones included, when its last Terminal closes', async () => {
    const { browser, tabs, terminals, first } = await opened();
    browser.pick('README.md', true);
    browser.openFile('src/main.ts');
    await tabs.closeTerminals([first.id]);
    expect(tabs.tabsOf(timmy.projectId)).toEqual([]);
    // A Terminal opened again in a Tab of that id (as a restore could) finds no File Views left behind.
    terminals.create(timmy.projectId, first.tabId);
    const [again] = tabs.tabsOf(timmy.projectId);
    expect(tabs.filesOf(again)).toEqual([]);
  });

  it('closes a File View on its own, and its Pane with it', async () => {
    const { browser, tabs, tab, first, panes, files } = await opened();
    browser.pick('README.md', true);
    tabs.closeFiles(tab(), ['README.md']);
    expect(files()).toEqual([]);
    expect(panes()).toEqual([`*${first.id}`]);
  });
});

describe('FilesBrowser filter', () => {
  const opened = async (disk?: FakeDisk) => {
    const context = await setup(disk === undefined ? {} : { files: { disks: { [timmy.cwd]: disk } } });
    context.browser.toggle();
    await context.settle();
    return context;
  };

  it('finds files whose path contains the text, whatever its case, with the folder apart from the name', async () => {
    const { browser } = await opened();
    browser.filter.set('APP');
    expect(browser.matches()).toEqual({ status: 'ready', items: [{ path: 'src/app/a.ts', name: 'a.ts', dir: 'src/app' }], truncated: false });
    browser.filter.set('readme');
    expect(browser.matches()).toEqual({ status: 'ready', items: [{ path: 'README.md', name: 'README.md', dir: '' }], truncated: false });
  });

  it('says nothing matched, which is not an error, and never offers what git ignores', async () => {
    const { browser } = await opened();
    browser.filter.set('.env');
    expect(browser.matches()).toEqual({ status: 'ready', items: [], truncated: false });
  });

  it('shows at most 200 matches and says there are more', async () => {
    const many = Array.from({ length: 250 }, (_, index) => `f${index}.txt`);
    const { browser } = await opened({ dirs: { '': [] }, files: {}, index: many });
    browser.filter.set('f');
    const matches = browser.matches();
    expect(matches.status === 'ready' && matches.items).toHaveLength(200);
    expect(matches).toMatchObject({ truncated: true });
  });

  it('is unavailable outside a git repository, while the tree keeps working', async () => {
    const { browser, nodes } = await opened({ dirs: { '': [file('a.txt')] }, files: {}, index: null });
    browser.filter.set('a');
    expect(browser.matches()).toEqual({ status: 'unavailable', reason: 'noGit' });
    expect(nodes().map((node) => node.label)).toEqual(['a.txt']);
  });

  it('is loading until the index arrives', async () => {
    const { browser } = await setup();
    browser.toggle();
    browser.filter.set('a');
    expect(browser.matches()).toEqual({ status: 'loading' });
  });

});

/** A Project an agent has worked in: git reports each kind of Changed file. */
const changedDisk = (): FakeDisk => ({
  ...timmyDisk(),
  dirs: {
    ...timmyDisk().dirs,
    '': [folder('generated'), folder('node_modules', true), folder('src'), folder('vendor'), file('.env', true), file('notes.md'), file('README.md')],
    src: [folder('app'), file('main.ts'), file('renamed.ts')],
    generated: [folder('deep')],
    'generated/deep': [file('out.ts')],
    vendor: [folder('lib')],
    'vendor/lib': [file('lib.ts')],
  },
  changes: [
    change('README.md', 'modified'),
    change('notes.md', 'untracked'),
    change('src/main.ts', 'added'),
    change('src/renamed.ts', 'renamed'),
    change('src/old.ts', 'deleted'),
    change('src/app/a.ts', 'modified'),
    change('generated', 'untracked', true),
    change('vendor/lib', 'modified', true),
  ],
});

describe('FilesBrowser changed markers', () => {
  const opened = async () => {
    const context = await setup({ files: { disks: { [timmy.cwd]: changedDisk() } } });
    // A Tab on screen, so a picked file has a Pane to open in.
    const tabs = TestBed.inject(TabsState);
    const terminals = TestBed.inject(TerminalsState);
    const first = terminals.create(timmy.projectId);
    terminals.setCurrent(first.id);
    context.browser.toggle();
    await context.settleChanges();
    /** The paths of the File Views open in that Tab. */
    const openFiles = () => tabs.tabsOf(timmy.projectId).flatMap((tab) => tabs.filesOf(tab).map((open) => open.path));
    return { ...context, openFiles };
  };

  it('marks each Changed file with its letter and its name, and a collapsed folder with how many changes it holds', async () => {
    const { nodes, marked, listDirs } = await opened();
    expect(marked()).toEqual(['generated [U]', 'node_modules', 'src [4]', 'vendor [1]', '.env', 'notes.md [U]', 'README.md [M]']);
    // The count of a folder never read comes from git, not from reading it.
    expect(listDirs()).toEqual(['Files.listDir:']);
    const readme = nodes().find((node) => node.label === 'README.md');
    expect(readme?.flag).toMatchObject({ text: 'M', label: 'Modificado' });
    expect(nodes().find((node) => node.label === 'src')?.flag).toMatchObject({ text: '4', label: '4 con cambios dentro' });
  });

  it('tells the kinds apart by letter, lists a deleted file struck through in its folder, and drops the count of an open folder', async () => {
    const { browser, settle, marked, nodes } = await opened();
    browser.setFolderOpen('src', true);
    await settle();
    expect(marked()).toEqual([
      'generated [U]',
      'node_modules',
      'src',
      '  app [1]',
      '  main.ts [A]',
      '  ~old.ts [D]',
      '  renamed.ts [R]',
      'vendor [1]',
      '.env',
      'notes.md [U]',
      'README.md [M]',
    ]);
    const src = nodes().find((node) => node.label === 'src');
    expect(src?.children?.map((node) => node.flag?.label)).toEqual(['1 con cambios dentro', 'Añadido', 'Eliminado', 'Renombrado']);
  });

  it('does not open a deleted file: there is nothing to read', async () => {
    const { browser, settle, openFiles } = await opened();
    browser.setFolderOpen('src', true);
    await settle();
    browser.pick('src/old.ts');
    browser.pick('src/old.ts', true);
    await settle();
    expect(openFiles()).toEqual([]);
    expect(browser.selected()).toBeNull();
  });

  it('marks the files of a wholly untracked folder as untracked once it is opened', async () => {
    const { browser, settle, marked } = await opened();
    browser.setFolderOpen('generated', true);
    await settle();
    expect(marked().slice(0, 2)).toEqual(['generated/deep [U]', '  out.ts [U]']);
  });

  it('marks a submodule with changes as one modified folder', async () => {
    const { browser, settle, marked } = await opened();
    browser.setFolderOpen('vendor', true);
    await settle();
    expect(marked()).toContain('vendor/lib [M]');
  });

  it('lists a deleted file of a folder that is gone altogether, inside that folder', async () => {
    const disk = changedDisk();
    const { browser, settle, settleChanges, marked } = await setup({
      files: { disks: { [timmy.cwd]: { ...disk, changes: [change('old/a.ts', 'deleted'), change('old/b.ts', 'deleted')] } } },
    });
    browser.toggle();
    await settleChanges();
    expect(marked()).toContain('old [2]');
    browser.setFolderOpen('old', true);
    await settle();
    expect(marked()).toEqual(expect.arrayContaining(['old', '  ~a.ts [D]', '  ~b.ts [D]']));
  });

  it('counts the changes, and toggles a tree of only the changed paths and their folders, all open, then back', async () => {
    const { browser, settle, marked } = await opened();
    expect(browser.changedCount()).toBe(8);
    browser.toggleChangedOnly();
    await settle();
    expect(browser.changedOnly()).toBe(true);
    expect(marked()).toEqual([
      'generated [U]',
      'src',
      '  app',
      '    a.ts [M]',
      '  main.ts [A]',
      '  ~old.ts [D]',
      '  renamed.ts [R]',
      'vendor/lib [M]',
      'notes.md [U]',
      'README.md [M]',
    ]);
    expect(nodes(browser).find((node) => node.label === 'src')?.expanded).toBe(true);
    browser.toggleChangedOnly();
    await settle();
    expect(marked()).toEqual(['generated [U]', 'node_modules', 'src [4]', 'vendor [1]', '.env', 'notes.md [U]', 'README.md [M]']);
  });

  it('opens a changed file from the changed-only tree, which needs no folder read', async () => {
    const { browser, settle, openFiles, listDirs } = await opened();
    browser.toggleChangedOnly();
    browser.pick('src/app/a.ts');
    await settle();
    expect(openFiles()).toEqual(['src/app/a.ts']);
    expect(browser.selected()).toBe('src/app/a.ts');
    expect(listDirs()).toEqual(['Files.listDir:']);
  });

  it('shows no markers and no count in a folder that is not a repository, and the tree still works', async () => {
    const { browser, marked } = await setup({ files: { disks: { [timmy.cwd]: { ...timmyDisk(), index: null } } } }).then(async (context) => {
      context.browser.toggle();
      await context.settleChanges();
      return context;
    });
    expect(marked()).toEqual(['node_modules', 'src', '.env', 'README.md']);
    expect(browser.changedCount()).toBe(0);
  });
});

/** The nodes of the tree on screen. */
const nodes = (browser: FilesBrowser): readonly TreeNode[] => {
  const tree = browser.tree();
  return tree.status === 'ready' ? tree.nodes : [];
};

describe('FilesBrowser changed markers refresh', () => {
  const withTerminals = async () => {
    const context = await setup({ files: { disks: { [timmy.cwd]: changedDisk(), [ascua.cwd]: { dirs: { '': [file('LICENSE')] }, files: {}, index: ['LICENSE'] } } } });
    const terminals = TestBed.inject(TerminalsState);
    const mine = terminals.create(timmy.projectId);
    const theirs = terminals.create(ascua.projectId);
    context.browser.toggle();
    await context.settleChanges();
    return { ...context, mine: mine.id, theirs: theirs.id };
  };

  it('reads git status once when the sidebar opens, and again each time it is opened', async () => {
    const { browser, settleChanges, changesCalls } = await withTerminals();
    expect(changesCalls()).toBe(1);
    browser.toggle();
    browser.toggle();
    await settleChanges();
    expect(changesCalls()).toBe(2);
  });

  it('reads again after a burst of Hook reports from a Terminal of the Project, once, when the burst is over', async () => {
    const { backend, report, mine, marked, settleChanges, changesCalls } = await withTerminals();
    backend.files.disks[timmy.cwd]!.changes = [change('README.md', 'modified'), change('notes.md', 'modified')];
    report(mine, 'Working');
    report(mine, 'Working');
    report(mine, 'Working');
    report(mine, 'Done');
    await settleChanges();
    expect(changesCalls()).toBe(2);
    expect(marked()).toContain('notes.md [M]');
  });

  it('does not read again for a Terminal of another Project, nor for a report that is not a tool use or a stop', async () => {
    const { report, mine, theirs, settleChanges, changesCalls } = await withTerminals();
    report(theirs, 'Working');
    report(mine, 'Waiting');
    await settleChanges();
    expect(changesCalls()).toBe(1);
  });

  it('reads again when the window gets the focus back', async () => {
    const { settleChanges, changesCalls } = await withTerminals();
    window.dispatchEvent(new Event('focus'));
    await settleChanges();
    expect(changesCalls()).toBe(2);
  });

  it('does not read while the sidebar is closed', async () => {
    const { browser, report, mine, settleChanges, changesCalls } = await withTerminals();
    browser.toggle();
    report(mine, 'Done');
    window.dispatchEvent(new Event('focus'));
    await settleChanges();
    expect(changesCalls()).toBe(1);
  });

  it('runs one status at a time, keeping the last markers while it runs, and runs once more for what came meanwhile', async () => {
    const { backend, report, mine, marked, settleChanges, changesCalls } = await withTerminals();
    let release = () => {};
    backend.files.changesGate = new Promise<void>((resolve) => (release = resolve));
    backend.files.disks[timmy.cwd]!.changes = [change('notes.md', 'modified')];
    report(mine, 'Done');
    await settleChanges();
    expect(changesCalls()).toBe(2);
    report(mine, 'Working');
    report(mine, 'Done');
    await settleChanges();
    // The second run waits for the first.
    expect(changesCalls()).toBe(2);
    expect(marked()).toContain('README.md [M]');
    backend.files.changesGate = undefined;
    release();
    await settleChanges();
    await settleChanges();
    expect(changesCalls()).toBe(3);
    expect(marked()).toContain('notes.md [M]');
    expect(marked()).toContain('README.md');
  });

  it('keeps the last markers, silently, when a later status fails', async () => {
    const { backend, report, mine, marked, settleChanges, changesCalls } = await withTerminals();
    backend.files.changesFail = true;
    report(mine, 'Done');
    await settleChanges();
    expect(changesCalls()).toBe(2);
    expect(marked()).toContain('README.md [M]');
  });

  it('starts a Project without the markers of the one before', async () => {
    const { projects, browser, settle, settleChanges, marked } = await withTerminals();
    projects.select(ascua.projectId);
    await settle();
    expect(marked()).toEqual(['LICENSE']);
    expect(browser.changedCount()).toBe(0);
    await settleChanges();
    expect(marked()).toEqual(['LICENSE']);
  });
});

describe('FilesBrowser refresh, width and Projects', () => {
  it('reads the open folders and the index again on refresh, and a closed folder when it is next opened', async () => {
    const { backend, browser, settle, outline, listDirs } = await setup();
    browser.toggle();
    await settle();
    browser.setFolderOpen('src', true);
    await settle();
    browser.setFolderOpen('src', false);
    backend.files.disks[timmy.cwd].dirs[''] = [...backend.files.disks[timmy.cwd].dirs[''], file('NEW.md')];
    backend.files.disks[timmy.cwd].dirs['src'] = [file('fresh.ts')];
    await browser.refresh();
    await settle();
    expect(outline()).toContain('NEW.md');
    browser.setFolderOpen('src', true);
    await settle();
    expect(outline()).toEqual(['node_modules', 'src', '  fresh.ts', '.env', 'README.md', 'NEW.md']);
    expect(backend.files.calls.filter((call) => call === 'Files.list')).toHaveLength(2);
    expect(listDirs().filter((call) => call === 'Files.listDir:src')).toHaveLength(2);
  });

  it('keeps what is on screen while a refresh reads, instead of blanking the tree', async () => {
    const { browser, settle, outline } = await setup();
    browser.toggle();
    await settle();
    const refreshing = browser.refresh();
    expect(outline()).toContain('README.md');
    await refreshing;
  });

  it('remembers a width chosen by the user, and starts from the one it remembered', async () => {
    const { backend, browser, settle } = await setup({ files: { width: 480 } });
    TestBed.inject(WorkspaceLayoutState).width.set(2000);
    browser.toggle();
    await settle();
    expect(browser.width()).toBe(480);
    browser.setWidth(520);
    browser.saveWidth();
    await settle();
    expect(backend.files.width).toBe(520);
  });

  it('keeps the width between 280 px and 60% of the window', async () => {
    const { browser } = await setup();
    const layout = TestBed.inject(WorkspaceLayoutState);
    layout.width.set(1000);
    browser.setWidth(900);
    expect(browser.shownWidth()).toBe(600);
    browser.setWidth(100);
    expect(browser.shownWidth()).toBe(280);
    layout.width.set(400);
    browser.setWidth(380);
    expect(browser.shownWidth()).toBe(280);
  });

  it('shows the tree of the Project selected, each with what it remembered', async () => {
    const { projects, browser, settle, outline } = await setup();
    browser.toggle();
    await settle();
    browser.setFolderOpen('src', true);
    await settle();
    projects.select(ascua.projectId);
    await settle();
    expect(outline()).toEqual(['LICENSE']);
    projects.select(timmy.projectId);
    await settle();
    expect(outline()).toEqual(['node_modules', 'src', '  app', '  main.ts', '.env', 'README.md']);
  });
});

describe('FilesBrowser Ctrl+P', () => {
  it('opens the sidebar and asks for the filter to be focused', async () => {
    const { browser, settle } = await setup();
    expect(browser.filterFocus()).toBe(0);
    browser.openWithFilter();
    await settle();
    expect(browser.open()).toBe(true);
    expect(browser.filterFocus()).toBe(1);
  });

  it('keeps it open when it already is, and asks again for the filter', async () => {
    const { browser, settle } = await setup();
    browser.openWithFilter();
    browser.openWithFilter();
    await settle();
    expect(browser.open()).toBe(true);
    expect(browser.filterFocus()).toBe(2);
  });

  it('does nothing without a Project in view', async () => {
    const { browser, projects } = await setup();
    projects.deselect();
    browser.openWithFilter();
    expect(browser.open()).toBe(false);
    browser.toggle();
    expect(browser.open()).toBe(false);
  });
});

describe('FilesBrowser compact folders', () => {
  /** `src` holds only `app`, which holds only `core`, which holds only `rpc`: one chain. `docs` holds a file. */
  const chainDisk = (): FakeDisk => ({
    dirs: {
      '': [folder('docs'), folder('src'), file('package.json')],
      docs: [file('guide.md')],
      src: [folder('app')],
      'src/app': [folder('core')],
      'src/app/core': [folder('rpc')],
      'src/app/core/rpc': [folder('wire'), file('handshake.ts'), file('retry.ts')],
      'src/app/core/rpc/wire': [file('frame.ts')],
    },
    files: { 'src/app/core/rpc/handshake.ts': text('handshake\n') },
    index: ['docs/guide.md', 'package.json', 'src/app/core/rpc/handshake.ts', 'src/app/core/rpc/retry.ts', 'src/app/core/rpc/wire/frame.ts'],
  });
  const opened = async (saved?: ReadonlyArray<string>) => {
    const context = await setup({
      files: {
        disks: { [timmy.cwd]: chainDisk() },
        ...(saved === undefined ? {} : { saved: { [timmy.projectId]: { expanded: saved, lastFile: null } } }),
      },
    });
    context.browser.toggle();
    await context.settle();
    return context;
  };

  it('opens a chain of single-child folders as one row, down to the first level with more than one entry', async () => {
    const { browser, settle, outline, nodes } = await opened();
    expect(outline()).toEqual(['docs', 'src', 'package.json']);
    browser.setFolderOpen('src', true);
    await settle();
    expect(outline()).toEqual(['docs', 'src/app/core/rpc', '  wire', '  handshake.ts', '  retry.ts', 'package.json']);
    expect(nodes()[1]).toMatchObject({ id: 'src', kind: 'folder', expanded: true });
  });

  it('closes the chain as one unit, keeps it as one row, and opens it again in one step', async () => {
    const { backend, browser, settle, outline } = await opened();
    browser.setFolderOpen('src', true);
    await settle();
    browser.setFolderOpen('src', false);
    expect(outline()).toEqual(['docs', 'src/app/core/rpc', 'package.json']);
    expect(backend.files.saved[timmy.projectId]?.expanded).toEqual([]);
    browser.setFolderOpen('src', true);
    await settle();
    expect(outline()).toEqual(['docs', 'src/app/core/rpc', '  wire', '  handshake.ts', '  retry.ts', 'package.json']);
  });

  it('remembers every folder of an open chain, and opens it again from what it remembered', async () => {
    const first = await opened();
    first.browser.setFolderOpen('src', true);
    await first.settle();
    first.browser.setFolderOpen('src/app/core/rpc/wire', true);
    await first.settle();
    expect(first.backend.files.saved[timmy.projectId]?.expanded).toEqual(['src', 'src/app', 'src/app/core', 'src/app/core/rpc', 'src/app/core/rpc/wire']);
    TestBed.resetTestingModule();
    const { outline } = await opened(['src', 'src/app', 'src/app/core', 'src/app/core/rpc', 'src/app/core/rpc/wire']);
    expect(outline()).toEqual(['docs', 'src/app/core/rpc', '  wire', '    frame.ts', '  handshake.ts', '  retry.ts', 'package.json']);
  });

  it('follows the chain from a folder remembered alone, as it would when opened', async () => {
    const { outline } = await opened(['src']);
    expect(outline()).toEqual(['docs', 'src/app/core/rpc', '  wire', '  handshake.ts', '  retry.ts', 'package.json']);
  });

  it('leaves a folder with a single file as it is', async () => {
    const { browser, settle, outline } = await opened();
    browser.setFolderOpen('docs', true);
    await settle();
    expect(outline()).toEqual(['docs', '  guide.md', 'src', 'package.json']);
  });

  it('keeps an ignored folder apart from the chain of a folder git sees', async () => {
    const disk = chainDisk();
    disk.dirs['src'] = [folder('dist', true)];
    disk.dirs['src/dist'] = [file('out.js', true)];
    const { browser, settle, outline } = await setup({ files: { disks: { [timmy.cwd]: disk } } });
    browser.toggle();
    await settle();
    browser.setFolderOpen('src', true);
    await settle();
    expect(outline()).toEqual(['docs', 'src', '  dist', 'package.json']);
  });

  it('joins ignored folders into one chain too', async () => {
    const disk = chainDisk();
    disk.dirs[''] = [folder('node_modules', true)];
    disk.dirs['node_modules'] = [folder('pkg', true)];
    disk.dirs['node_modules/pkg'] = [file('index.js', true), file('package.json', true)];
    const { browser, settle, outline, nodes } = await setup({ files: { disks: { [timmy.cwd]: disk } } });
    browser.toggle();
    await settle();
    browser.setFolderOpen('node_modules', true);
    await settle();
    expect(outline()).toEqual(['node_modules/pkg', '  index.js', '  package.json']);
    expect(nodes()[0]).toMatchObject({ dimmed: true });
  });

  it('splits the row on refresh when a folder of the chain gets a second entry', async () => {
    const { backend, browser, settle, outline } = await opened();
    browser.setFolderOpen('src', true);
    await settle();
    backend.files.disks[timmy.cwd].dirs['src/app'] = [folder('core'), file('main.ts')];
    await browser.refresh();
    await settle();
    expect(outline()).toEqual(['docs', 'src/app', '  core/rpc', '    wire', '    handshake.ts', '    retry.ts', '  main.ts', 'package.json']);
  });

  it('does not follow a chain inside a folder that was closed meanwhile', async () => {
    const { backend, browser, settle, listDirs } = await opened();
    browser.setFolderOpen('src', true);
    await settle();
    backend.files.disks[timmy.cwd].dirs['src/app/core/rpc/wire'] = [folder('deep')];
    backend.files.disks[timmy.cwd].dirs['src/app/core/rpc/wire/deep'] = [file('x.ts')];
    browser.setFolderOpen('src/app/core/rpc/wire', true);
    browser.setFolderOpen('src', false);
    await settle();
    expect(listDirs()).not.toContain('Files.listDir:src/app/core/rpc/wire/deep');
    expect(backend.files.saved[timmy.projectId]?.expanded).toEqual(['src/app/core/rpc/wire']);
  });

  it('opens a file inside the chain, and the filter still finds it by its full path', async () => {
    const { browser, settle } = await opened();
    browser.setFolderOpen('src', true);
    await settle();
    browser.pick('src/app/core/rpc/handshake.ts');
    await settle();
    expect(browser.selected()).toBe('src/app/core/rpc/handshake.ts');
    browser.filter.set('core/rpc/hand');
    expect(browser.matches()).toMatchObject({ status: 'ready', items: [{ path: 'src/app/core/rpc/handshake.ts', name: 'handshake.ts', dir: 'src/app/core/rpc' }] });
  });
});

describe('FilesBrowser review fixes', () => {
  it('says a folder is gone when it is opened after being deleted, rather than loading forever', async () => {
    const { backend, browser, settle, nodes } = await setup();
    browser.toggle();
    await settle();
    delete backend.files.disks[timmy.cwd].dirs['src'];
    browser.setFolderOpen('src', true);
    await settle();
    const children = nodes().find((node) => node.id === 'src')?.children ?? [];
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ disabled: true, label: TestBed.inject(I18n).t('files.folderGone') });
  });

  it('keeps the wide width chosen in a big window when it is saved from a small one', async () => {
    const { backend, browser, settle } = await setup();
    const layout = TestBed.inject(WorkspaceLayoutState);
    layout.width.set(2000);
    browser.setWidth(900);
    layout.width.set(800);
    expect(browser.shownWidth()).toBe(480);
    browser.saveWidth();
    await settle();
    expect(backend.files.width).toBe(900);
  });
});
