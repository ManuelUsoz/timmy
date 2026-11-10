import { TestBed } from '@angular/core/testing';
import type { ILink } from '@xterm/xterm';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import type { FakeFiles } from './files-fakes';
import { text } from './files-fakes';
import { LineSelections } from './line-selection';
import { panesOf, type TabLayout } from './pane-layout';
import { PATH_LINK_CACHE_MS, PathLinks, folderFromOsc7, type PathLinkBuffer } from './path-links';
import { layerFakeBackend, makeBackend, project } from './projects-fakes';
import { ProjectsState } from './projects-state';
import type { Tab } from './tabs';
import { TabsState } from './tabs-state';
import { TerminalsState } from './terminals-state';
import { viewKey } from './views';
import { Effect } from 'effect';

const timmy = project('timmy');
const CACHE = 40;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A Terminal's screen as xterm keeps it: rows of `cols` characters, a long line wrapped onto the rows after it. Rows are
 * 1-based, as xterm's link providers count them.
 */
const screen = (cols: number, lines: ReadonlyArray<string>): PathLinkBuffer & { readonly cols: number } => {
  const rows = lines.flatMap((line) => {
    const parts: string[] = [];
    for (let at = 0; at === 0 || at < line.length; at += cols) parts.push(line.slice(at, at + cols));
    return parts.map((part, index) => ({ text: part, isWrapped: index > 0 }));
  });
  return {
    cols,
    buffer: {
      active: {
        length: rows.length,
        getLine: (y: number) => {
          const row = rows[y];
          if (row === undefined) return undefined;
          return { isWrapped: row.isWrapped, translateToString: (trim?: boolean) => (trim === true ? row.text.trimEnd() : row.text.padEnd(cols)) };
        },
      },
    },
  };
};

const setup = async (links: FakeFiles['disks'][string]['links'] = {}) => {
  const backend = makeBackend({
    projects: [timmy],
    files: {
      disks: {
        [timmy.cwd]: {
          dirs: { '': [] },
          files: { 'src/app/foo.ts': text('x\n'.repeat(60)), 'README.md': text('# timmy\n') },
          index: [],
          links,
        },
      },
    } as unknown as FakeFiles,
  });
  const layer = makeDesktopTestLayer(layerFakeBackend(backend));
  const runtime = { run: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(effect as never, layer)) };
  TestBed.configureTestingModule({
    providers: [
      { provide: EffectRuntime, useValue: runtime },
      { provide: PATH_LINK_CACHE_MS, useValue: CACHE },
    ],
  });
  await TestBed.inject(ProjectsState).refresh();
  const terminals = TestBed.inject(TerminalsState);
  const tabs = TestBed.inject(TabsState);
  const selections = TestBed.inject(LineSelections);
  const first = terminals.create(timmy.projectId);
  terminals.setCurrent(first.id);
  const tab = (): Tab => tabs.tabsOf(timmy.projectId).find((each) => each.id === first.tabId) as Tab;
  const layout = (): TabLayout => tabs.layoutOf(tab()) as TabLayout;
  /** Each Pane as the keys of its expanded View, left to right; the focused Pane starred. */
  const panes = () => panesOf(layout()).map((pane) => `${pane.id === layout().focused ? '*' : ''}${viewKey(pane.expanded)}`);
  const files = () => tabs.filesOf(tab()).map((open) => `${open.path}${open.pinned ? ' (pinned)' : ''}`);
  const asked = () => backend.files.calls.filter((call) => call.startsWith('Files.resolvePathLink:')).map((call) => call.slice('Files.resolvePathLink:'.length));
  const pathLinks = TestBed.inject(PathLinks);
  let folder: string | undefined;
  /** The link provider of the Terminal `first`, over a screen of these lines. */
  const provider = (cols: number, lines: ReadonlyArray<string>) =>
    pathLinks.provider(screen(cols, lines), { terminal: first.id, cwd: timmy.cwd, folder: () => folder });
  /** What xterm gets when the pointer is over row `y`. */
  const hover = (made: ReturnType<typeof provider>, y: number) =>
    new Promise<ReadonlyArray<ILink>>((resolve) => made.provideLinks(y, (found) => resolve(found ?? [])));
  const setFolder = (value: string | undefined) => {
    folder = value;
  };
  return { backend, tabs, selections, first, tab, panes, files, asked, provider, hover, setFolder };
};

const at = (link: ILink) => `${link.range.start.x},${link.range.start.y}-${link.range.end.x},${link.range.end.y} ${link.text}`;
const click = (modifiers: Partial<Pick<MouseEvent, 'ctrlKey' | 'metaKey'>> = {}) => new MouseEvent('mouseup', modifiers);
const target = (path: string, start: number | null = null, end = start) => ({ path, start, end });

describe('Path links in a Terminal', () => {
  it('finds the paths of the hovered line and keeps those main says are files of the Project', async () => {
    const { hover, provider, asked } = await setup({ 'src/app/foo.ts:42': target('src/app/foo.ts', 42) });
    const found = await hover(provider(80, ['error in src/app/foo.ts:42 near build/out, see https://x.dev/a.ts', 'README.md']), 1);
    expect(found.map(at)).toEqual(['10,1-26,1 src/app/foo.ts:42']);
    expect(asked()).toEqual(['src/app/foo.ts:42', 'build/out']);
  });

  it('takes a path out of quotes, parentheses and backticks, with every form of position', async () => {
    const { hover, provider, asked } = await setup();
    await hover(provider(200, ['"a.ts" (src/b.ts:3:7) `c/d.ts:4-9` e.ts(42,7) \'f.ts\' [g/h] a/x.ts b/y.ts:2. file:///C:/z.ts plain words 1.5']), 1);
    expect(asked()).toEqual(['a.ts', 'src/b.ts:3:7', 'c/d.ts:4-9', 'e.ts(42,7)', 'f.ts', 'g/h', 'a/x.ts', 'b/y.ts:2']);
  });

  it('finds a path wrapped across rows from either row, as one link over both', async () => {
    const { hover, provider } = await setup({ 'src/app/foo.ts:42': target('src/app/foo.ts', 42) });
    const lines = ['see src/app/foo.ts:42 now'];
    const made = provider(12, lines);
    expect((await hover(made, 1)).map(at)).toEqual(['5,1-9,2 src/app/foo.ts:42']);
    expect((await hover(made, 2)).map(at)).toEqual(['5,1-9,2 src/app/foo.ts:42']);
  });

  it('asks main one candidate at a time, and remembers each answer for a few seconds', async () => {
    const { backend, hover, provider, asked } = await setup({ 'a.ts': target('a.ts') });
    let open = () => undefined as void;
    backend.files.linksGate = new Promise<void>((resolve) => (open = resolve));
    const made = provider(80, ['a.ts b.ts']);
    const first = hover(made, 1);
    await wait(10);
    expect(asked()).toEqual(['a.ts']);
    open();
    backend.files.linksGate = undefined;
    expect((await first).map((link) => link.text)).toEqual(['a.ts']);
    expect(asked()).toEqual(['a.ts', 'b.ts']);
    await hover(made, 1);
    expect(asked()).toEqual(['a.ts', 'b.ts']);
    await wait(CACHE * 2);
    await hover(made, 1);
    expect(asked()).toEqual(['a.ts', 'b.ts', 'a.ts', 'b.ts']);
  });

  it("asks with the Terminal's folder when its shell reported one", async () => {
    const { hover, provider, asked, setFolder } = await setup();
    setFolder('/work/timmy/packages/app');
    await hover(provider(80, ['src/main.ts']), 1);
    expect(asked()).toEqual(['src/main.ts@/work/timmy/packages/app']);
  });

  it('underlines a link and, while hovered, tells the path and line it opens', async () => {
    const { hover, provider } = await setup({ 'src/app/foo.ts(42,7)': target('src/app/foo.ts', 42), 'README.md': target('README.md') });
    const made = provider(80, ['src/app/foo.ts(42,7) README.md']);
    const [code, readme] = await hover(made, 1);
    expect(code.decorations).toEqual({ underline: true, pointerCursor: false });
    code.hover?.(new MouseEvent('mousemove', { clientX: 30, clientY: 40 }), code.text);
    expect(made.hint()).toEqual({ label: 'src/app/foo.ts:42', x: 30, y: 40 });
    code.leave?.(new MouseEvent('mouseleave'), code.text);
    expect(made.hint()).toBeUndefined();
    readme.hover?.(new MouseEvent('mousemove', { clientX: 1, clientY: 2 }), readme.text);
    expect(made.hint()?.label).toBe('README.md');
  });

  it('opens nothing on a plain click, which only selects text', async () => {
    const { hover, provider, files } = await setup({ 'src/app/foo.ts:42': target('src/app/foo.ts', 42) });
    const [link] = await hover(provider(80, ['src/app/foo.ts:42']), 1);
    link.activate(click(), link.text);
    expect(files()).toEqual([]);
  });

  it('opens Ctrl+click as a preview File View right of the Terminal, its line marked as the Line selection', async () => {
    const { hover, provider, files, panes, first, selections } = await setup({ 'src/app/foo.ts:42-50': target('src/app/foo.ts', 42, 50) });
    const [link] = await hover(provider(80, ['src/app/foo.ts:42-50']), 1);
    link.activate(click({ ctrlKey: true }), link.text);
    expect(files()).toEqual(['src/app/foo.ts']);
    expect(panes()).toEqual([first.id, '*file:src/app/foo.ts']);
    expect(selections.of(first.tabId, 'src/app/foo.ts')).toEqual({ anchor: 42, start: 42, end: 50 });
    expect(selections.revealed()).toMatchObject({ tab: first.tabId, path: 'src/app/foo.ts', start: 42, end: 50 });
  });

  it('opens Cmd+click too, and a second click focuses the File View already open and scrolls it again', async () => {
    const { hover, provider, files, panes, first, selections, tabs } = await setup({
      'src/app/foo.ts:3': target('src/app/foo.ts', 3),
      'src/app/foo.ts:9': target('src/app/foo.ts', 9),
    });
    const [three, nine] = await hover(provider(80, ['src/app/foo.ts:3 src/app/foo.ts:9']), 1);
    three.activate(click({ metaKey: true }), three.text);
    const firstReveal = selections.revealed();
    // The user goes back to the Terminal, then clicks the other line of the same file.
    tabs.update(tabs.tabsOf(first.projectId)[0], (layout) => ({ ...layout, focused: panesOf(layout)[0].id }));
    nine.activate(click({ ctrlKey: true }), nine.text);
    expect(files()).toEqual(['src/app/foo.ts']);
    expect(panes()).toEqual([first.id, '*file:src/app/foo.ts']);
    expect(selections.of(first.tabId, 'src/app/foo.ts')).toEqual({ anchor: 9, start: 9, end: 9 });
    expect(selections.revealed()).not.toBe(firstReveal);
  });

  it('opens a path without a position at the top, with nothing marked', async () => {
    const { hover, provider, files, first, selections } = await setup({ 'README.md': target('README.md') });
    const [link] = await hover(provider(80, ['README.md']), 1);
    link.activate(click({ ctrlKey: true }), link.text);
    expect(files()).toEqual(['README.md']);
    expect(selections.of(first.tabId, 'README.md')).toBeUndefined();
  });

  it('opens a Markdown file with a line in Fuente, forcing source mode for that View', async () => {
    const { hover, provider, files, first, selections } = await setup({ 'README.md:5': target('README.md', 5) });
    const [link] = await hover(provider(80, ['README.md:5']), 1);
    link.activate(click({ ctrlKey: true }), link.text);
    expect(files()).toEqual(['README.md']);
    expect(selections.of(first.tabId, 'README.md')).toEqual({ anchor: 5, start: 5, end: 5 });
    expect(selections.revealed()).toMatchObject({ tab: first.tabId, path: 'README.md', start: 5, end: 5, source: true });
  });

  it('accepts a Windows backslash path with a position', async () => {
    const { hover, provider, files, first, selections } = await setup({ 'src\\app\\foo.ts:7': target('src/app/foo.ts', 7) });
    const [link] = await hover(provider(80, ['src\\app\\foo.ts:7']), 1);
    link.activate(click({ ctrlKey: true }), link.text);
    expect(files()).toEqual(['src/app/foo.ts']);
    expect(selections.of(first.tabId, 'src/app/foo.ts')).toEqual({ anchor: 7, start: 7, end: 7 });
  });
});

describe('folderFromOsc7', () => {
  it("reads the folder a shell reports, on Windows and elsewhere; anything else is no folder", () => {
    expect(folderFromOsc7('file://host/home/ana/my%20app')).toBe('/home/ana/my app');
    expect(folderFromOsc7('file://DESKTOP/C:/Users/ana/timmy')).toBe('C:/Users/ana/timmy');
    expect(folderFromOsc7('file:///C:/Users/ana')).toBe('C:/Users/ana');
    expect(folderFromOsc7('https://example.com/x')).toBeUndefined();
    expect(folderFromOsc7('garbage')).toBeUndefined();
  });
});
