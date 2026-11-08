import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Effect, Layer, Stream } from 'effect';
import { NotificationRpcs } from '../../../shared/notification/notification.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { file, folder, text, type FakeDisk } from './files-fakes';
import { FilesBrowser } from './files-browser';
import { layerFakeBackend, makeBackend, project } from './projects-fakes';
import { WorkspaceComponent } from './workspace';
import { WorkspaceLayoutState } from './workspace-layout';
import { provideWorkspaceRouter } from './workspace.routes';

const timmy = project('timmy');
const ascua = project('ascua');

const timmyDisk = (): FakeDisk => ({
  dirs: {
    '': [folder('node_modules', true), folder('src'), file('.env', true), file('big.log'), file('logo.png'), file('README.md')],
    src: [file('main.ts')],
    node_modules: [folder('pkg', true)],
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
  return { backend, fixture, el, settle, t, sidebar, icon, rows, labels, rowOf, filter, ctrlP, keyOn, click, type, browser: TestBed.inject(FilesBrowser) };
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
    expect(labels().slice(0, 3)).toEqual(['node_modules', 'pkg', 'src']);
    expect(backend.files.calls).toContain('Files.listDir:node_modules');
  });

  it('shows a file in place of the tree, with line numbers and no trailing blank line', async () => {
    const { sidebar, rowOf, click, ctrlP } = await setup();
    await ctrlP();
    await click(rowOf('src'));
    await click(rowOf('main.ts'));
    expect(sidebar()?.querySelector('[role=treeitem]')).toBeNull();
    expect(sidebar()?.querySelector('.head .name')?.textContent?.trim()).toBe('main.ts');
    expect(sidebar()?.querySelector('.head .dir')?.textContent?.trim()).toBe('src');
    expect(sidebar()?.querySelector('.code .gutter')?.textContent).toBe('1\n2');
    expect(sidebar()?.querySelector('.code .source')?.textContent).toBe('const a = 1;\nconst b = 2;');
  });

  it("says a binary file can't be previewed, and a big one is too large, without showing content", async () => {
    const { sidebar, rowOf, click, ctrlP, t } = await setup();
    await ctrlP();
    await click(rowOf('logo.png'));
    expect(sidebar()?.querySelector('.note')?.textContent?.trim()).toBe(t('files.cantPreview'));
    expect(sidebar()?.querySelector('.code')).toBeNull();
    await click(sidebar()?.querySelector('.head .back'));
    await click(rowOf('big.log'));
    expect(sidebar()?.querySelector('.note')?.textContent?.trim()).toBe(t('files.tooLarge', { size: '2.5 MB' }));
  });

  it('says a file is gone when it was deleted after being listed, and still lets the user go back', async () => {
    const { sidebar, rowOf, click, ctrlP, backend, labels, t } = await setup();
    await ctrlP();
    delete backend.files.disks[timmy.cwd].files['README.md'];
    await click(rowOf('README.md'));
    expect(sidebar()?.querySelector('.note')?.textContent?.trim()).toBe(t('files.gone'));
    await click(sidebar()?.querySelector('.head .back'));
    expect(labels()).toContain('README.md');
  });

  it('goes back to the tree with the back button, the file highlighted', async () => {
    const { sidebar, rowOf, click, ctrlP } = await setup();
    await ctrlP();
    await click(rowOf('README.md'));
    await click(sidebar()?.querySelector('.head .back'));
    expect(sidebar()?.querySelector('.code')).toBeNull();
    expect(rowOf('README.md').getAttribute('aria-selected')).toBe('true');
  });

  it('takes Esc to the tree from a file and closes from the tree, only while the focus is inside', async () => {
    const { sidebar, rowOf, click, ctrlP, keyOn, el } = await setup();
    await ctrlP();
    await click(rowOf('README.md'));
    await keyOn(sidebar()!.querySelector('.head .back')!, { key: 'Escape' });
    expect(sidebar()?.querySelector('[role=treeitem]')).not.toBeNull();
    await keyOn(el.querySelector('app-tab-bar')!, { key: 'Escape' });
    expect(sidebar()).not.toBeNull();
    await keyOn(sidebar()!.querySelector('input.filter')!, { key: 'Escape' });
    expect(sidebar()).toBeNull();
  });

  it('keeps the keyboard inside the sidebar when a file opens and when it closes, so Esc still reaches it', async () => {
    const { sidebar, rowOf, click, ctrlP, filter, el, keyOn } = await setup();
    await ctrlP();
    // The row the user clicked has the focus, and it goes away with the tree.
    rowOf('README.md').focus();
    await click(rowOf('README.md'));
    expect(sidebar()!.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).toBe(sidebar()!.querySelector('.code'));
    await keyOn(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(filter());
    expect(el.querySelector('app-files-sidebar')).not.toBeNull();
  });

  it('puts the keyboard on the way back when there is no file to read', async () => {
    const { sidebar, rowOf, click, ctrlP } = await setup();
    await ctrlP();
    rowOf('logo.png').focus();
    await click(rowOf('logo.png'));
    expect(document.activeElement).toBe(sidebar()!.querySelector('.head .back'));
  });

  it('goes back to the tree and refocuses the filter with Ctrl+P from a file', async () => {
    const { sidebar, rowOf, click, ctrlP, filter } = await setup();
    await ctrlP();
    await click(rowOf('README.md'));
    await ctrlP();
    expect(sidebar()?.querySelector('.code')).toBeNull();
    expect(document.activeElement).toBe(filter());
  });

  it('filters by name into a flat list, and Enter opens the first match', async () => {
    const { sidebar, filter, type, keyOn, labels, ctrlP } = await setup();
    await ctrlP();
    await type(filter()!, 'MAIN');
    const items = Array.from(sidebar()!.querySelectorAll<HTMLElement>('.results [role=option]'));
    expect(items.map((item) => [item.querySelector('.name')?.textContent?.trim(), item.querySelector('.dir')?.textContent?.trim()])).toEqual([['main.ts', 'src']]);
    expect(labels()).toEqual([]);
    await keyOn(filter()!, { key: 'Enter' });
    expect(sidebar()?.querySelector('.head .name')?.textContent?.trim()).toBe('main.ts');
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
