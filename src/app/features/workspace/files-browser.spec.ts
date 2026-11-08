import { TestBed } from '@angular/core/testing';
import type { TreeNode } from '../../shared/ui/tree-view/tree-view.types';
import { EffectRuntime } from '../../core/effect-runtime';
import { FilesBrowser } from './files-browser';
import { file, folder, text, type FakeDisk, type FakeFiles } from './files-fakes';
import { fakeRuntime, makeBackend, project } from './projects-fakes';
import { ProjectsState } from './projects-state';
import { WorkspaceLayoutState } from './workspace-layout';

const timmy = project('timmy');
const ascua = project('ascua');

const timmyDisk = (): FakeDisk => ({
  dirs: {
    '': [folder('node_modules', true), folder('src'), file('.env', true), file('README.md')],
    src: [folder('app'), file('main.ts')],
    'src/app': [file('a.ts')],
    node_modules: [folder('pkg', true)],
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

const setup = async (initial: { readonly files?: Partial<FakeFiles> } = {}) => {
  const backend = makeBackend({
    projects: [timmy, ascua],
    files: {
      disks: { [timmy.cwd]: timmyDisk(), [ascua.cwd]: { dirs: { '': [file('LICENSE')] }, files: {}, index: ['LICENSE'] } },
      ...initial.files,
    } as FakeFiles,
  });
  TestBed.configureTestingModule({ providers: [{ provide: EffectRuntime, useValue: fakeRuntime(backend) }] });
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
  return { backend, projects, browser, settle, nodes, outline, listDirs };
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
    expect(outline().slice(0, 3)).toEqual(['node_modules', '  pkg', 'src']);
  });

  it('remembers the open folders for the Project', async () => {
    const { backend, browser, settle } = await setup();
    browser.toggle();
    await settle();
    browser.setFolderOpen('src', true);
    browser.setFolderOpen('src/app', true);
    await settle();
    expect(backend.files.saved[timmy.projectId]).toEqual({ expanded: ['src', 'src/app'], lastFile: null, view: 'tree' });
  });

  it('opens again on the folders it remembered, reading each of them', async () => {
    const { browser, settle, outline, listDirs } = await setup({
      files: { saved: { [timmy.projectId]: { expanded: ['src', 'src/app'], lastFile: null, view: 'tree' } } },
    });
    browser.toggle();
    await settle();
    expect(outline()).toEqual(['node_modules', 'src', '  app', '    a.ts', '  main.ts', '.env', 'README.md']);
    expect([...listDirs()].sort()).toEqual(['Files.listDir:', 'Files.listDir:src', 'Files.listDir:src/app']);
  });

  it('forgets a remembered folder that is gone instead of showing it as broken', async () => {
    const { backend, browser, settle, outline } = await setup({
      files: { saved: { [timmy.projectId]: { expanded: ['src', 'deleted'], lastFile: null, view: 'tree' } } },
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


describe('FilesBrowser file view', () => {
  const opened = async (initial: Parameters<typeof setup>[0] = {}) => {
    const context = await setup(initial);
    context.browser.toggle();
    await context.settle();
    return context;
  };

  it('reads a file when it is picked and shows it in place of the tree, remembering it', async () => {
    const { backend, browser, settle } = await opened();
    browser.openFile('src/main.ts');
    expect(browser.view()).toBe('file');
    expect(browser.file()).toEqual({ status: 'loading', path: 'src/main.ts' });
    await settle();
    expect(browser.file()).toEqual({ status: 'text', path: 'src/main.ts', content: 'main\n' });
    expect(backend.files.calls.filter((call) => call.startsWith('Files.read:'))).toEqual(['Files.read:src/main.ts']);
    expect(backend.files.saved[timmy.projectId]).toEqual({ expanded: [], lastFile: 'src/main.ts', view: 'file' });
  });

  it('tells a binary file and a file that is too large from text, with no content', async () => {
    const { browser, settle } = await opened();
    browser.openFile('logo.png');
    await settle();
    expect(browser.file()).toEqual({ status: 'binary', path: 'logo.png' });
    browser.openFile('big.log');
    await settle();
    expect(browser.file()).toEqual({ status: 'tooLarge', path: 'big.log', size: 2_000_000 });
  });

  it('says a file is gone, and stays on it so the way back is still there', async () => {
    const { browser, settle } = await opened();
    browser.openFile('deleted.ts');
    await settle();
    expect(browser.file()).toEqual({ status: 'gone', path: 'deleted.ts' });
    expect(browser.view()).toBe('file');
  });

  it('goes back to the tree with the file highlighted and its folders open and read', async () => {
    const { backend, browser, settle, outline } = await opened();
    browser.openFile('src/app/a.ts');
    await settle();
    browser.back();
    await settle();
    expect(browser.view()).toBe('tree');
    expect(browser.selected()).toBe('src/app/a.ts');
    expect(outline()).toEqual(['node_modules', 'src', '  app', '    a.ts', '  main.ts', '.env', 'README.md']);
    expect(backend.files.saved[timmy.projectId]).toEqual({ expanded: ['src', 'src/app'], lastFile: 'src/app/a.ts', view: 'tree' });
  });

  it('takes Esc to the tree from a file, and closes the sidebar from the tree', async () => {
    const { browser, settle } = await opened();
    browser.openFile('README.md');
    await settle();
    browser.escape();
    expect(browser.view()).toBe('tree');
    expect(browser.open()).toBe(true);
    browser.escape();
    expect(browser.open()).toBe(false);
  });

  it('resumes the view it was left in when it is closed and opened again', async () => {
    const { browser, settle } = await opened();
    browser.openFile('README.md');
    await settle();
    browser.toggle();
    browser.toggle();
    await settle();
    expect(browser.view()).toBe('file');
    expect(browser.file()).toMatchObject({ status: 'text', path: 'README.md' });
  });

  it('reads the file it remembered when it opens in the file view', async () => {
    const { browser, settle } = await opened({
      files: { saved: { [timmy.projectId]: { expanded: [], lastFile: 'README.md', view: 'file' } } },
    });
    expect(browser.view()).toBe('file');
    expect(browser.file()).toEqual({ status: 'text', path: 'README.md', content: '# timmy\n' });
  });

  it('falls back to the tree, and forgets the file, when the remembered one is gone', async () => {
    const { backend, browser, settle } = await opened({
      files: { saved: { [timmy.projectId]: { expanded: [], lastFile: 'deleted.ts', view: 'file' } } },
    });
    await settle();
    expect(browser.view()).toBe('tree');
    expect(browser.selected()).toBeNull();
    expect(backend.files.saved[timmy.projectId]).toEqual({ expanded: [], lastFile: null, view: 'tree' });
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

  it('opens a match as a file and clears the filter, so Back returns to the whole tree', async () => {
    const { browser, settle } = await opened();
    browser.filter.set('main');
    browser.openFile('src/main.ts');
    await settle();
    expect(browser.filter()).toBe('');
    expect(browser.view()).toBe('file');
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

  it('goes back to the tree from a file, so the filter is there to focus', async () => {
    const { browser, settle } = await setup();
    browser.toggle();
    await settle();
    browser.openFile('README.md');
    await settle();
    browser.openWithFilter();
    expect(browser.view()).toBe('tree');
    expect(browser.filterFocus()).toBe(1);
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

describe('FilesBrowser pick', () => {
  it('opens a file picked in the tree, and does nothing for a folder or a row that is not an entry', async () => {
    const { browser, settle } = await setup();
    browser.toggle();
    await settle();
    browser.setFolderOpen('src', true);
    await settle();
    browser.pick('src');
    browser.pick('src/\u0000loading');
    browser.pick('nope.ts');
    expect(browser.view()).toBe('tree');
    browser.pick('src/main.ts');
    await settle();
    expect(browser.view()).toBe('file');
    expect(browser.file()).toMatchObject({ status: 'text', path: 'src/main.ts' });
  });
});
