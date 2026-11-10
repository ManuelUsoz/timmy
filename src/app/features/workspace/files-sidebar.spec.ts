import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Effect, Layer, Stream } from 'effect';
import { NotificationRpcs } from '../../../shared/notification/notification.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { change, file, folder, text, type FakeDisk } from './files-fakes';
import { CHANGES_DEBOUNCE_MS, FilesBrowser } from './files-browser';
import { layerFakeBackend, makeBackend, project } from './projects-fakes';
import { terminalPath } from './tabs';
import { TerminalsState } from './terminals-state';
import { WorkspaceComponent } from './workspace';
import { WorkspaceLayoutState } from './workspace-layout';
import { provideWorkspaceRouter } from './workspace.routes';

const timmy = project('timmy');
const ascua = project('ascua');

const timmyDisk = (): FakeDisk => ({
  dirs: {
    '': [folder('node_modules', true), folder('src'), file('.env', true), file('big.log'), file('logo.png'), file('README.md')],
    src: [file('main.ts')],
    node_modules: [folder('pkg', true), file('.package-lock.json', true)],
  },
  files: {
    'README.md': text('# timmy\n\nread me\n'),
    'src/main.ts': text('const a = 1;\nconst b = 2;'),
    'logo.png': { kind: 'binary' },
    'big.log': { kind: 'tooLarge', size: 2_621_440 },
  },
  index: ['README.md', 'logo.png', 'big.log', 'src/main.ts'],
});

/** The Workspace on the fake backend, on the Tab screen of timmy, where the tab bar and its Files icon are. */
const setup = async (disk: FakeDisk = timmyDisk()) => {
  const backend = makeBackend({ projects: [timmy, ascua], files: { disks: { [timmy.cwd]: disk } } as never });
  const layer = makeDesktopTestLayer(Layer.mergeAll(layerFakeBackend(backend), NotificationRpcs.toLayer({ 'Notification.subscribe': () => Stream.empty })));
  await TestBed.configureTestingModule({
    imports: [WorkspaceComponent],
    providers: [
      provideWorkspaceRouter(),
      { provide: CHANGES_DEBOUNCE_MS, useValue: 0 },
      { provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } },
    ],
  }).compileComponents();
  TestBed.inject(WorkspaceLayoutState).width.set(1400);
  const fixture = TestBed.createComponent(WorkspaceComponent);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise((resolve) => setTimeout(resolve));
      fixture.detectChanges();
    }
  };
  fixture.detectChanges();
  await settle();
  await TestBed.inject(Router).navigate(['/projects', timmy.projectId]);
  await settle();

  const t = (key: Parameters<I18n['t']>[0], params?: Parameters<I18n['t']>[1]) => TestBed.inject(I18n).t(key, params);
  const sidebar = () => el.querySelector<HTMLElement>('app-files-sidebar');
  const icon = () => el.querySelector<HTMLButtonElement>(`app-tab-bar button.tool[aria-label="${t('tabs.files')}"]`);
  const rows = () => Array.from(sidebar()?.querySelectorAll<HTMLElement>('[role=treeitem]') ?? []);
  const labels = () => rows().map((row) => row.querySelector('.as-treeitem__label')?.textContent?.trim());
  const rowOf = (label: string) => rows().find((row) => row.querySelector('.as-treeitem__label')?.textContent?.trim() === label)!;
  const filter = () => sidebar()?.querySelector<HTMLInputElement>('input.filter') ?? null;
  const press = async (init: KeyboardEventInit) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    await settle();
  };
  const ctrlP = () => press({ key: 'p', code: 'KeyP', ctrlKey: true });
  /** A key pressed on the focused element, so it bubbles through the sidebar as a real one does. */
  const keyOn = async (target: Element, init: KeyboardEventInit) => {
    target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
    await settle();
  };
  const click = async (element: Element | null | undefined) => {
    if (element == null) throw new Error('nothing to click');
    (element as HTMLElement).click();
    await settle();
  };
  const type = async (input: HTMLInputElement, value: string) => {
    input.value = value;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  /** Opens a Tab of timmy with one Terminal, on screen: where a file picked opens as a File View. */
  const withTab = async () => {
    const terminal = TestBed.inject(TerminalsState).create(timmy.projectId);
    await TestBed.inject(Router).navigate(terminalPath(terminal));
    await settle();
    return terminal;
  };
  const panes = () => Array.from(el.querySelectorAll<HTMLElement>('app-pane-stack'));
  /** The first Pane showing a File View. */
  const filePane = () => panes().find((pane) => pane.querySelector('.view-header[data-kind=file]') !== null);
  return { backend, fixture, el, settle, t, sidebar, icon, rows, labels, rowOf, filter, ctrlP, keyOn, click, type, withTab, panes, filePane, browser: TestBed.inject(FilesBrowser) };
};

describe('FilesSidebar', () => {
  it('is closed until asked, and has no sample tree behind it', async () => {
    const { sidebar, icon } = await setup();
    expect(sidebar()).toBeNull();
    expect(icon()?.getAttribute('aria-pressed')).toBe('false');
    expect(icon()?.getAttribute('aria-disabled')).toBeNull();
  });

  it('opens from the Files icon and closes from it, saying whether it is pressed', async () => {
    const { sidebar, icon, click } = await setup();
    await click(icon());
    expect(sidebar()).not.toBeNull();
    expect(icon()?.getAttribute('aria-pressed')).toBe('true');
    await click(icon());
    expect(sidebar()).toBeNull();
    expect(icon()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('opens with Ctrl+P on the Project, and the filter has the keyboard', async () => {
    const { sidebar, filter, ctrlP, t } = await setup();
    await ctrlP();
    expect(sidebar()?.getAttribute('aria-label')).toBe(t('files.title'));
    expect(sidebar()?.textContent).toContain('timmy');
    expect(document.activeElement).toBe(filter());
  });

  it('has a header with the title, a refresh and a close button, and the Project in a section row of its own', async () => {
    const { sidebar, ctrlP, t } = await setup();
    await ctrlP();
    const head = sidebar()!.querySelector('header')!;
    expect(head.querySelector('h2')?.textContent?.trim()).toBe(t('files.title'));
    expect(head.querySelector('svg.panel')).not.toBeNull();
    expect(Array.from(head.querySelectorAll('button')).map((button) => button.getAttribute('aria-label'))).toEqual([t('files.refresh'), t('files.close')]);
    expect(head.textContent).not.toContain('timmy');
    const section = sidebar()!.querySelector('.section')!;
    expect(section.querySelector('.section-label')?.textContent?.trim()).toBe('timmy');
    // Nothing changed: no count.
    expect(section.querySelector('.section-count')).toBeNull();
  });

  it('marks the changed files, counts them in the section row, and toggles the changed-only tree from there', async () => {
    const { sidebar, ctrlP, click, labels, rowOf, settle, t } = await setup({
      ...timmyDisk(),
      changes: [change('README.md', 'modified'), change('src/main.ts', 'deleted')],
    });
    await ctrlP();
    await settle();
    const count = () => sidebar()!.querySelector<HTMLButtonElement>('.section button.section-count');
    expect(count()?.textContent?.trim()).toBe(t('files.changedCount', { count: 2 }));
    expect(count()?.getAttribute('aria-pressed')).toBe('false');
    const flag = (label: string) => rowOf(label).querySelector('.as-treeitem__flag');
    expect(flag('README.md')?.textContent?.trim()).toBe('M');
    expect(flag('README.md')?.getAttribute('aria-label')).toBe(t('files.modified'));
    expect(flag('README.md')?.getAttribute('data-tone')).toBe('warning');
    expect(flag('src')?.textContent?.trim()).toBe('1');
    await click(count());
    expect(count()?.getAttribute('aria-pressed')).toBe('true');
    expect(labels()).toEqual(['src', 'main.ts', 'README.md']);
    expect(rowOf('main.ts').querySelector('.as-treeitem__label--struck')).not.toBeNull();
    expect(flag('main.ts')?.getAttribute('data-tone')).toBe('error');
    await click(count());
    expect(labels()).toEqual(['node_modules', 'src', '.env', 'big.log', 'logo.png', 'README.md']);
  });

  it('shows Ctrl P on the filter field, and no tab strip', async () => {
    const { sidebar, ctrlP } = await setup();
    await ctrlP();
    const field = sidebar()!.querySelector('.field')!;
    expect(field.querySelector('input.filter')).not.toBeNull();
    expect(Array.from(field.querySelectorAll('kbd')).map((key) => key.textContent?.trim())).toEqual(['Ctrl', 'P']);
    expect(sidebar()!.querySelector('[role=tablist]')).toBeNull();
  });

  it('closes from the close button in its header', async () => {
    const { sidebar, icon, ctrlP, click, t } = await setup();
    await ctrlP();
    await click(sidebar()!.querySelector(`header button[aria-label="${t('files.close')}"]`));
    expect(sidebar()).toBeNull();
    expect(icon()?.getAttribute('aria-pressed')).toBe('false');
  });

  it('shows a chain of single-child folders as one row that opens and closes as one', async () => {
    const disk = timmyDisk();
    disk.dirs[''] = [folder('src'), file('README.md')];
    disk.dirs['src'] = [folder('app')];
    disk.dirs['src/app'] = [folder('core')];
    disk.dirs['src/app/core'] = [file('a.ts'), file('b.ts')];
    disk.files['src/app/core/a.ts'] = text('a\n');
    const { sidebar, labels, rowOf, click, ctrlP, withTab, filePane } = await setup(disk);
    await ctrlP();
    await click(rowOf('src'));
    expect(labels()).toEqual(['src/app/core', 'a.ts', 'b.ts', 'README.md']);
    expect(rowOf('src/app/core').getAttribute('aria-expanded')).toBe('true');
    await click(rowOf('src/app/core'));
    expect(labels()).toEqual(['src/app/core', 'README.md']);
    await click(rowOf('src/app/core'));
    await withTab();
    await click(rowOf('a.ts'));
    expect(filePane()?.querySelector('.view-header .name')?.textContent?.trim()).toBe('a.ts');
    expect(filePane()?.querySelector('.view-header .dir')?.textContent?.trim()).toBe('src/app/core');
    expect(sidebar()?.querySelector('[role=treeitem]')).not.toBeNull();
  });

  it('lists the root: folders first, what git ignores dimmed, and nothing from a folder not opened', async () => {
    const { labels, rowOf, ctrlP } = await setup();
    await ctrlP();
    expect(labels()).toEqual(['node_modules', 'src', '.env', 'big.log', 'logo.png', 'README.md']);
    expect(rowOf('node_modules').hasAttribute('data-dimmed')).toBe(true);
    expect(rowOf('src').hasAttribute('data-dimmed')).toBe(false);
  });

  it('reads a folder when it is clicked, including an ignored one', async () => {
    const { labels, rowOf, click, ctrlP, backend } = await setup();
    await ctrlP();
    await click(rowOf('node_modules'));
    expect(labels().slice(0, 4)).toEqual(['node_modules', 'pkg', '.package-lock.json', 'src']);
    expect(backend.files.calls).toContain('Files.listDir:node_modules');
  });

  it('opens a clicked file as a preview File View beside the Terminal, while the sidebar keeps the tree', async () => {
    const { sidebar, rowOf, click, ctrlP, withTab, filePane, panes, t } = await setup();
    await withTab();
    await ctrlP();
    await click(rowOf('src'));
    await click(rowOf('main.ts'));
    expect(panes()).toHaveLength(2);
    const pane = filePane()!;
    expect(pane.querySelector('.view-header .name')?.textContent?.trim()).toBe('main.ts');
    expect(pane.querySelector('.view-header .name')?.classList).toContain('preview');
    expect(pane.querySelector('.view-header .dir')?.textContent?.trim()).toBe('src');
    expect(pane.querySelector('.view-header .tag')?.textContent?.trim()).toBe(t('fileView.preview'));
    expect(pane.querySelector('.code .gutter')?.textContent).toBe('1\n2');
    expect(pane.querySelector('.code .source')?.textContent).toBe('const a = 1;\nconst b = 2;');
    expect(sidebar()?.querySelector('[role=treeitem]')).not.toBeNull();
    expect(sidebar()?.querySelector('.code')).toBeNull();
    expect(rowOf('main.ts').getAttribute('aria-selected')).toBe('true');
  });

  it('gives the keyboard to the File View the click opened, so it scrolls at once', async () => {
    const { rowOf, click, ctrlP, withTab, filePane } = await setup();
    await withTab();
    await ctrlP();
    rowOf('README.md').focus();
    await click(rowOf('README.md'));
    expect(document.activeElement).toBe(filePane()!.querySelector('app-file-view .scroll'));
  });

  it("says in the File View that a binary file can't be previewed, a big one is too large and a deleted one is gone", async () => {
    const { backend, rowOf, click, ctrlP, withTab, filePane, panes, t } = await setup();
    await withTab();
    await ctrlP();
    const note = () => filePane()?.querySelector('app-file-view .note')?.textContent?.trim();
    await click(rowOf('logo.png'));
    expect(note()).toBe(t('files.cantPreview'));
    expect(filePane()?.querySelector('.code')).toBeNull();
    await click(rowOf('big.log'));
    expect(note()).toBe(t('files.tooLarge', { size: '2.5 MB' }));
    delete backend.files.disks[timmy.cwd].files['README.md'];
    await click(rowOf('README.md'));
    expect(note()).toBe(t('files.gone'));
    // Each click replaced the preview: still one File View.
    expect(panes()).toHaveLength(2);
  });

  it('pins a File View with a double click on its row, or with the pin button on its header', async () => {
    const { rowOf, click, ctrlP, withTab, panes, t, settle } = await setup();
    await withTab();
    await ctrlP();
    await click(rowOf('README.md'));
    rowOf('README.md').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    const header = (index: number) => panes()[index].querySelector('.view-header')!;
    expect(header(1).querySelector('.tag')).toBeNull();
    expect(header(1).querySelector('.pin')?.getAttribute('aria-pressed')).toBe('true');
    expect(header(1).querySelector('.pin')?.getAttribute('aria-label')).toBe(t('fileView.pinned'));
    // The next click opens a preview beside the pinned one.
    await click(rowOf('logo.png'));
    expect(panes()).toHaveLength(3);
    expect(header(2).querySelector('.tag')).not.toBeNull();
    await click(header(2).querySelector<HTMLElement>(`.pin[aria-label="${t('fileView.pin')}"]`));
    expect(header(2).querySelector('.tag')).toBeNull();
    expect(header(2).querySelector('.name')?.classList).not.toContain('preview');
  });

  it('closes a File View from its header, and the Terminal stays', async () => {
    const { rowOf, click, ctrlP, withTab, filePane, panes, t } = await setup();
    await withTab();
    await ctrlP();
    await click(rowOf('README.md'));
    await click(filePane()!.querySelector(`.view-header button[aria-label="${t('pane.close')}"]`));
    expect(filePane()).toBeUndefined();
    expect(panes()).toHaveLength(1);
  });

  it('only highlights a file picked with no Tab on screen: a File View needs a Tab', async () => {
    const { rowOf, click, ctrlP, panes } = await setup();
    await ctrlP();
    await click(rowOf('README.md'));
    expect(panes()).toHaveLength(0);
    expect(rowOf('README.md').getAttribute('aria-selected')).toBe('true');
  });

  it('closes on Esc, only while the focus is inside', async () => {
    const { sidebar, ctrlP, keyOn, el } = await setup();
    await ctrlP();
    await keyOn(el.querySelector('app-tab-bar')!, { key: 'Escape' });
    expect(sidebar()).not.toBeNull();
    await keyOn(sidebar()!.querySelector('input.filter')!, { key: 'Escape' });
    expect(sidebar()).toBeNull();
  });

  it('filters by name into a flat list, and Enter opens the first match as a File View', async () => {
    const { sidebar, filter, type, keyOn, labels, ctrlP, withTab, filePane } = await setup();
    await withTab();
    await ctrlP();
    await type(filter()!, 'MAIN');
    const items = Array.from(sidebar()!.querySelectorAll<HTMLElement>('.results [role=option]'));
    expect(items.map((item) => [item.querySelector('.name')?.textContent?.trim(), item.querySelector('.dir')?.textContent?.trim()])).toEqual([['main.ts', 'src']]);
    expect(labels()).toEqual([]);
    await keyOn(filter()!, { key: 'Enter' });
    expect(filePane()?.querySelector('.view-header .name')?.textContent?.trim()).toBe('main.ts');
  });

  it('says when nothing matches', async () => {
    const { sidebar, filter, type, ctrlP, t } = await setup();
    await ctrlP();
    await type(filter()!, 'zzz');
    expect(sidebar()?.querySelector('.results')).toBeNull();
    expect(sidebar()?.querySelector('.note')?.textContent?.trim()).toBe(t('files.noMatches'));
  });

  it('turns the filter off, with the reason, outside a git repository while the tree keeps working and Esc still reaches it', async () => {
    const { sidebar, filter, ctrlP, labels, t } = await setup({ dirs: { '': [file('a.txt')] }, files: {}, index: null });
    await ctrlP();
    // Read-only, not disabled: a disabled field cannot hold the keyboard, and then Esc would go nowhere.
    expect(filter()?.readOnly).toBe(true);
    expect(filter()?.getAttribute('aria-disabled')).toBe('true');
    expect(document.activeElement).toBe(filter());
    expect(sidebar()?.querySelector('.hint')?.textContent?.trim()).toBe(t('files.filterNoGit'));
    expect(labels()).toEqual(['a.txt']);
  });

  it('shows a Project it cannot read as a failure with a way to try again, not as empty', async () => {
    const { backend, sidebar, ctrlP, click, labels } = await setup();
    backend.files.broken.add('');
    await ctrlP();
    expect(sidebar()?.querySelector('.note')?.textContent).toContain('the disk is unreadable');
    expect(labels()).toEqual([]);
    backend.files.broken.delete('');
    await click(sidebar()?.querySelector('.retry'));
    expect(labels()).toContain('README.md');
  });

  it('says an empty Project is empty', async () => {
    const { sidebar, ctrlP, t } = await setup({ dirs: { '': [] }, files: {}, index: [] });
    await ctrlP();
    expect(sidebar()?.querySelector('.note')?.textContent?.trim()).toBe(t('files.emptyFolder'));
  });

  it('reads again on Refresh', async () => {
    const { backend, sidebar, ctrlP, click, labels } = await setup();
    await ctrlP();
    backend.files.disks[timmy.cwd].dirs[''] = [file('NEW.md')];
    await click(sidebar()?.querySelector('.head .refresh'));
    expect(labels()).toEqual(['NEW.md']);
  });

  it('is resized from its edge with the keyboard, and remembers the width', async () => {
    const { backend, sidebar, ctrlP, keyOn, settle } = await setup();
    await ctrlP();
    const edge = sidebar()!.querySelector<HTMLElement>('[role=separator]')!;
    expect(edge.getAttribute('aria-valuenow')).toBe('360');
    await keyOn(edge, { key: 'ArrowLeft' });
    expect(edge.getAttribute('aria-valuenow')).toBe('376');
    expect(sidebar()!.style.width).toBe('376px');
    await keyOn(edge, { key: 'ArrowRight' });
    await keyOn(edge, { key: 'ArrowRight' });
    expect(edge.getAttribute('aria-valuenow')).toBe('344');
    edge.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    await settle();
    expect(backend.files.width).toBe(344);
  });
});
