import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Effect, Layer, Stream } from 'effect';
import { NotificationRpcs } from '../../../shared/notification/notification.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { change, file, folder, hunkOf, text, type FakeDisk } from './files-fakes';
import { CHANGES_DEBOUNCE_MS } from './files-browser';
import { layerFakeBackend, makeBackend, project } from './projects-fakes';
import { terminalPath } from './tabs';
import { TabsState } from './tabs-state';
import { TerminalsState } from './terminals-state';
import { WorkspaceComponent } from './workspace';
import { WorkspaceLayoutState } from './workspace-layout';
import { provideWorkspaceRouter } from './workspace.routes';

const timmy = project('timmy');

const timmyDisk = (): FakeDisk => ({
  dirs: {
    '': [folder('src'), file('big.log'), file('locked.key'), file('logo.png'), file('README.md')],
    src: [file('main.ts'), file('util.ts')],
  },
  files: {
    'README.md': text('# timmy\n\nread me\n'),
    'src/main.ts': text('const a = 1;\nconst b = 2;'),
    'src/util.ts': text('export const twice = 2;\n'),
    'logo.png': { kind: 'binary' },
    'big.log': { kind: 'tooLarge', size: 2_621_440 },
  },
  images: { 'logo.png': { kind: 'notAnImage', size: 4096 } },
  unreadable: ['locked.key'],
  index: ['README.md', 'logo.png', 'big.log', 'locked.key', 'src/main.ts', 'src/util.ts'],
});

/** The Workspace on the fake backend with the Files browser open on timmy. */
const setup = async (disk: FakeDisk = timmyDisk()) => {
  const backend = makeBackend({ projects: [timmy], files: { disks: { [timmy.cwd]: disk } } as never });
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
  // The focus is real only in a document.
  document.body.appendChild(el);
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
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'p', code: 'KeyP', ctrlKey: true }));
  await settle();
  await settle();

  const t = (key: Parameters<I18n['t']>[0], params?: Parameters<I18n['t']>[1]) => TestBed.inject(I18n).t(key, params);
  const sidebar = () => el.querySelector<HTMLElement>('app-files-sidebar')!;
  const rows = () => Array.from(sidebar().querySelectorAll<HTMLElement>('[role=treeitem]'));
  const rowOf = (label: string) => rows().find((row) => row.querySelector('.as-treeitem__label')?.textContent?.trim() === label)!;
  const results = () => Array.from(sidebar().querySelectorAll<HTMLElement>('.results [role=option]'));
  const resultOf = (name: string) => results().find((item) => item.querySelector('.name')?.textContent?.trim() === name)!;
  const filter = () => sidebar().querySelector<HTMLInputElement>('input.filter')!;
  /** A key pressed where the keyboard is (or on `target`), bubbling as a real one does. Says whether its default was prevented. */
  const key = async (name: string, target: Element | null = document.activeElement) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: name });
    (target ?? document.body).dispatchEvent(event);
    await settle();
    return event.defaultPrevented;
  };
  /** Space on a row that has the keyboard, as the user presses it. */
  const space = async (row: HTMLElement) => {
    row.focus();
    return key(' ', row);
  };
  const click = async (element: Element | null | undefined) => {
    if (element == null) throw new Error('nothing to click');
    (element as HTMLElement).click();
    await settle();
  };
  const type = async (value: string) => {
    filter().value = value;
    filter().dispatchEvent(new Event('input', { bubbles: true }));
    await settle();
  };
  /** Opens a Tab of timmy with one Terminal, on screen: where a file opens as a File View. */
  const withTab = async () => {
    const terminal = TestBed.inject(TerminalsState).create(timmy.projectId);
    await TestBed.inject(Router).navigate(terminalPath(terminal));
    await settle();
    return terminal;
  };
  const look = () => el.querySelector<HTMLElement>('app-quick-look [role=dialog]');
  /** What the Quick look shows: the file's name, its folder, the counter, and its text or the note that stands for it. */
  const shown = () => {
    const dialog = look();
    if (dialog === null) return null;
    const read = (selector: string) => dialog.querySelector(selector)?.textContent?.trim();
    return { name: read('.name'), dir: read('.dir') ?? '', counter: read('.counter'), text: dialog.querySelector('.code') === null ? read('.note') : [...dialog.querySelectorAll('.line .text')].map((line) => line.textContent).join('\n') };
  };
  const panes = () => Array.from(el.querySelectorAll<HTMLElement>('app-pane-stack'));
  return { backend, el, settle, t, sidebar, rows, rowOf, results, resultOf, filter, key, space, click, type, withTab, look, shown, panes };
};

describe('Quick look', () => {
  afterEach(() => {
    document.querySelectorAll('app-workspace, [ng-version]').forEach((node) => node.remove());
  });

  it('opens with Space on a file row of the tree, over the Workspace, showing the file and taking the keyboard', async () => {
    const { rowOf, space, look, shown, t, el } = await setup();
    await space(rowOf('README.md'));
    expect(look()?.getAttribute('aria-modal')).toBe('true');
    expect(look()?.getAttribute('aria-label')).toBe(t('quickLook.label', { name: 'README.md' }));
    expect(shown()).toEqual({ name: 'README.md', dir: '', counter: t('quickLook.counter', { at: 4, total: 4, project: 'timmy' }), text: '# timmy\n\nread me' });
    expect(look()!.contains(document.activeElement)).toBe(true);
    // A modal of the Workspace, not a part of the sidebar.
    expect(look()!.closest('app-files-sidebar')).toBeNull();
    expect(el.contains(look())).toBe(true);
  });

  it('does not open from the filter field, where Space is a character, nor from a folder, which Space opens', async () => {
    const { rowOf, rows, filter, space, key, look } = await setup();
    filter().focus();
    expect(await key(' ')).toBe(false);
    expect(look()).toBeNull();
    await space(rowOf('src'));
    expect(look()).toBeNull();
    expect(rowOf('src').getAttribute('aria-expanded')).toBe('true');
    expect(rows()).toHaveLength(7);
  });

  it('opens with Space on a filter result, and Down from the field goes into the results', async () => {
    const { filter, type, key, results, resultOf, look, shown, t } = await setup();
    await type('.ts');
    filter().focus();
    await key('ArrowDown');
    expect(document.activeElement).toBe(results()[0]);
    // Space on a result is taken: it does not also click it.
    expect(await key(' ')).toBe(true);
    expect(shown()).toEqual({ name: 'main.ts', dir: 'src', counter: t('quickLook.counter', { at: 1, total: 2, project: 'timmy' }), text: 'const a = 1;\nconst b = 2;' });
    expect(look()!.contains(document.activeElement)).toBe(true);
    expect(resultOf('util.ts')).toBeDefined();
  });

  it('walks the filter results with Up and Down, counting, without wrapping at either end', async () => {
    const { type, space, key, resultOf, shown, t } = await setup();
    await type('.ts');
    await space(resultOf('main.ts'));
    const at = (index: number) => t('quickLook.counter', { at: index, total: 2, project: 'timmy' });
    await key('ArrowUp');
    expect(shown()).toMatchObject({ name: 'main.ts', counter: at(1) });
    await key('ArrowDown');
    expect(shown()).toMatchObject({ name: 'util.ts', counter: at(2), text: 'export const twice = 2;' });
    await key('ArrowDown');
    expect(shown()).toMatchObject({ name: 'util.ts', counter: at(2) });
    await key('ArrowUp');
    expect(shown()).toMatchObject({ name: 'main.ts', counter: at(1) });
  });

  it('walks the files of the tree as shown, skipping folders and what a closed folder holds', async () => {
    const { rowOf, click, space, key, shown, t } = await setup();
    const walk = async () => {
      const seen = [shown()?.name];
      for (;;) {
        await key('ArrowDown');
        if (shown()?.name === seen.at(-1)) return seen;
        seen.push(shown()?.name);
      }
    };
    await space(rowOf('big.log'));
    expect(await walk()).toEqual(['big.log', 'locked.key', 'logo.png', 'README.md']);
    await key('Escape');
    // With src open its files are part of the walk, in the tree's order.
    await click(rowOf('src'));
    await space(rowOf('main.ts'));
    expect(shown()?.counter).toBe(t('quickLook.counter', { at: 1, total: 6, project: 'timmy' }));
    expect(await walk()).toEqual(['main.ts', 'util.ts', 'big.log', 'locked.key', 'logo.png', 'README.md']);
  });

  it('walks only the changed files when "N con cambios" is on, a deleted one shown as gone', async () => {
    const { sidebar, rowOf, click, space, key, shown, settle, t } = await setup({
      ...timmyDisk(),
      files: { 'README.md': text('# timmy\n\nread me\n'), 'src/util.ts': text('export const twice = 2;\n') },
      changes: [change('README.md', 'modified'), change('src/main.ts', 'deleted'), change('src/util.ts', 'untracked')],
    });
    await settle();
    await click(sidebar().querySelector('.section button.section-count'));
    await space(rowOf('main.ts'));
    expect(shown()).toEqual({ name: 'main.ts', dir: 'src', counter: t('quickLook.counter', { at: 1, total: 3, project: 'timmy' }), text: t('files.gone') });
    await key('ArrowDown');
    expect(shown()).toMatchObject({ name: 'util.ts', counter: t('quickLook.counter', { at: 2, total: 3, project: 'timmy' }) });
    await key('ArrowDown');
    expect(shown()).toMatchObject({ name: 'README.md', counter: t('quickLook.counter', { at: 3, total: 3, project: 'timmy' }) });
  });

  it('shows the states of a File View: binary, too large, gone and unreadable', async () => {
    const { backend, rowOf, space, key, shown, look, t } = await setup();
    delete backend.files.disks[timmy.cwd].files['README.md'];
    await space(rowOf('big.log'));
    expect(shown()).toMatchObject({ name: 'big.log', text: t('files.tooLarge', { size: '2.5 MB' }) });
    await key('ArrowDown');
    expect(shown()).toMatchObject({ name: 'locked.key', text: t('files.unreadable') });
    await key('ArrowDown');
    expect(shown()).toMatchObject({ name: 'logo.png', text: t('reader.binary', { size: '4.0 KB' }) });
    await key('ArrowDown');
    expect(shown()).toMatchObject({ name: 'README.md', text: t('files.gone') });
    expect(look()!.querySelector('.code')).toBeNull();
  });

  it('shows an image as a picture fitted to the modal', async () => {
    const disk = timmyDisk();
    disk.images = { 'logo.png': { kind: 'image', type: 'image/png', bytes: new Uint8Array([1]), size: 2048, width: 64, height: 32 } };
    const { createObjectURL, revokeObjectURL } = URL;
    URL.createObjectURL = () => 'blob:timmy/logo';
    URL.revokeObjectURL = () => undefined;
    try {
      const { rowOf, space, look } = await setup(disk);
      await space(rowOf('logo.png'));
      expect(look()!.querySelector('.picture img')?.getAttribute('src')).toBe('blob:timmy/logo');
      expect(look()!.querySelector('.picture')?.classList.contains('actual')).toBe(false);
      expect([...look()!.querySelectorAll('.status > span')].map((part) => part.textContent?.trim())).toEqual(['64 × 32', '2.0 KB', 'PNG']);
    } finally {
      URL.createObjectURL = createObjectURL;
      URL.revokeObjectURL = revokeObjectURL;
    }
  });

  it('reads the file again on each step of its walk', async () => {
    const { backend, rowOf, space, key, shown } = await setup();
    await space(rowOf('logo.png'));
    await key('ArrowDown');
    backend.files.disks[timmy.cwd].files['README.md'] = text('changed since\n');
    await key('ArrowUp');
    await key('ArrowDown');
    expect(shown()).toMatchObject({ name: 'README.md', text: 'changed since' });
  });

  it('closes on Esc or Space, and the row of the last file shown has the keyboard and is the tree selection', async () => {
    const { rowOf, space, key, look } = await setup();
    await space(rowOf('big.log'));
    await key('ArrowDown');
    await key('ArrowDown');
    await key('Escape');
    expect(look()).toBeNull();
    expect(document.activeElement).toBe(rowOf('logo.png'));
    expect(rowOf('logo.png').getAttribute('aria-selected')).toBe('true');
    expect(rowOf('big.log').getAttribute('aria-selected')).toBe('false');
    // The tree walks on from that row.
    await key('ArrowDown');
    expect(document.activeElement).toBe(rowOf('README.md'));

    await space(rowOf('README.md'));
    await key('ArrowUp');
    await key(' ');
    expect(look()).toBeNull();
    expect(document.activeElement).toBe(rowOf('logo.png'));
  });

  it('gives the keyboard back to the filter result of the last file shown', async () => {
    const { type, space, key, resultOf, look, filter } = await setup();
    await type('.ts');
    await space(resultOf('main.ts'));
    await key('ArrowDown');
    await key('Escape');
    expect(look()).toBeNull();
    expect(document.activeElement).toBe(resultOf('util.ts'));
    expect(filter().value).toBe('.ts');
  });

  it('closes from its close button and from a click outside it', async () => {
    const { el, rowOf, space, click, look, t } = await setup();
    await space(rowOf('README.md'));
    await click(look()!.querySelector(`button[aria-label="${t('quickLook.close')}"]`));
    expect(look()).toBeNull();
    expect(document.activeElement).toBe(rowOf('README.md'));
    await space(rowOf('README.md'));
    await click(el.querySelector('app-quick-look .backdrop'));
    expect(look()).toBeNull();
  });

  it('opens the file shown as a preview File View on Enter, closes, and that View takes the keyboard', async () => {
    const { rowOf, space, key, look, withTab, panes, t } = await setup();
    await withTab();
    await space(rowOf('logo.png'));
    await key('ArrowDown');
    await key('Enter');
    expect(look()).toBeNull();
    expect(panes()).toHaveLength(2);
    const header = panes()[1].querySelector('.view-header[data-kind=file]')!;
    expect(header.querySelector('.name')?.textContent?.trim()).toBe('README.md');
    expect(header.querySelector('.tag')?.textContent?.trim()).toBe(t('fileView.preview'));
    expect(document.activeElement).toBe(panes()[1].querySelector('app-file-view .scroll'));
    expect(rowOf('README.md').getAttribute('aria-selected')).toBe('true');
  });

  it('gives the keyboard back to the row on Enter with no Tab to open the file in', async () => {
    const { rowOf, space, key, look, panes } = await setup();
    await space(rowOf('README.md'));
    await key('Enter');
    expect(look()).toBeNull();
    expect(panes()).toHaveLength(0);
    expect(document.activeElement).toBe(rowOf('README.md'));
    expect(rowOf('README.md').getAttribute('aria-selected')).toBe('true');
  });

  it('does not open a deleted file on Enter: there is nothing to read', async () => {
    const { sidebar, rowOf, click, space, key, look, withTab, panes, settle } = await setup({
      ...timmyDisk(),
      changes: [change('src/main.ts', 'deleted')],
    });
    await withTab();
    await settle();
    await click(sidebar().querySelector('.section button.section-count'));
    await space(rowOf('main.ts'));
    await key('Enter');
    expect(look()).not.toBeNull();
    expect(panes()).toHaveLength(1);
  });

  it('keeps Tab inside it, cycling both ways', async () => {
    const { rowOf, space, key, look, t } = await setup();
    await space(rowOf('README.md'));
    // README.md has no changes: the Cambios half is disabled and out of the cycle.
    const archivo = look()!.querySelector<HTMLElement>('.mode button[data-mode=file]')!;
    const close = look()!.querySelector<HTMLElement>(`button[aria-label="${t('quickLook.close')}"]`)!;
    const text = look()!.querySelector<HTMLElement>('app-file-view .scroll')!;
    const tab = async (shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Tab', shiftKey });
      document.activeElement!.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(await tab()).toBe(true);
    expect(document.activeElement).toBe(archivo);
    await tab();
    expect(document.activeElement).toBe(close);
    await tab();
    expect(document.activeElement).toBe(text);
    await tab();
    expect(document.activeElement).toBe(archivo);
    await tab(true);
    expect(document.activeElement).toBe(text);
    // Its keys still act from inside the text.
    await key('Escape');
    expect(look()).toBeNull();
  });

  describe('Archivo and Cambios', () => {
    /** timmy with README.md and src/util.ts changed, src/main.ts deleted, logo.png a changed binary; big.log is unchanged. */
    const changedDisk = (): FakeDisk => ({
      ...timmyDisk(),
      changes: [change('README.md', 'modified'), change('src/main.ts', 'deleted'), change('src/util.ts', 'untracked'), change('logo.png', 'modified')],
      diffs: {
        'README.md': hunkOf(' # timmy', ' ', '-read me', '+read me twice'),
        'src/main.ts': hunkOf('-const a = 1;', '-const b = 2;'),
        'src/util.ts': hunkOf('+export const twice = 2;'),
        'logo.png': { kind: 'binary' },
      },
    });
    const toggle = (look: HTMLElement) => ({
      file: look.querySelector<HTMLButtonElement>('.mode button[data-mode=file]')!,
      changes: look.querySelector<HTMLButtonElement>('.mode button[data-mode=changes]')!,
    });
    /** Which half of the toggle is on, and what the Cambios half says and allows. */
    const modeOf = (look: HTMLElement) => {
      const { file, changes } = toggle(look);
      return {
        on: file.getAttribute('aria-pressed') === 'true' ? 'file' : changes.getAttribute('aria-pressed') === 'true' ? 'changes' : 'none',
        changes: changes.textContent?.trim(),
        enabled: !changes.disabled,
      };
    };
    /** The diff shown, a line per row: its sign, its old and new numbers, its text. Null while Archivo is shown. */
    const diffShown = (look: HTMLElement) => {
      const view = look.querySelector('app-file-diff');
      if (view === null) return null;
      const rows = Array.from(view.querySelectorAll('.hunk, .row'));
      if (rows.length === 0) return view.querySelector('.note')?.textContent?.trim();
      const cell = (row: Element, selector: string) => row.querySelector(selector)?.textContent?.trim() ?? '';
      return rows.map((row) =>
        row.classList.contains('hunk') ? row.textContent?.trim() : `${cell(row, '.sign')}|${cell(row, '.old')}|${cell(row, '.new')}|${cell(row, '.text')}`,
      );
    };

    it('shows Archivo first, and Right shows the changes of a changed file, unified, with a sign on each line', async () => {
      const { rowOf, space, key, look, shown, t } = await setup(changedDisk());
      await space(rowOf('README.md'));
      expect(modeOf(look()!)).toEqual({ on: 'file', changes: t('quickLook.changes'), enabled: true });
      expect(shown()?.text).toBe('# timmy\n\nread me');
      expect(diffShown(look()!)).toBeNull();
      await key('ArrowRight');
      expect(modeOf(look()!).on).toBe('changes');
      expect(diffShown(look()!)).toEqual(['@@ -1,3 +1,3 @@', '|1|1|# timmy', '|2|2|', '−|3||read me', '+||3|read me twice']);
      expect(look()!.querySelector('app-file-view')).toBeNull();
      await key('ArrowLeft');
      expect(modeOf(look()!).on).toBe('file');
      expect(shown()?.text).toBe('# timmy\n\nread me');
    });

    it('switches with a click on either half', async () => {
      const { rowOf, space, click, look } = await setup(changedDisk());
      await space(rowOf('README.md'));
      await click(toggle(look()!).changes);
      expect(modeOf(look()!).on).toBe('changes');
      await click(toggle(look()!).file);
      expect(modeOf(look()!).on).toBe('file');
    });

    it('keeps Cambios visible but disabled with "Sin cambios" on an unchanged file, and Right does nothing', async () => {
      const { rowOf, space, key, look, shown, t } = await setup(changedDisk());
      await space(rowOf('big.log'));
      expect(modeOf(look()!)).toEqual({ on: 'file', changes: t('quickLook.noChanges'), enabled: false });
      await key('ArrowRight');
      expect(modeOf(look()!).on).toBe('file');
      expect(shown()?.text).toBe(t('files.tooLarge', { size: '2.5 MB' }));
    });

    it('disables Cambios for a changed binary file, which has no lines to compare', async () => {
      const { rowOf, space, key, look, t } = await setup(changedDisk());
      await space(rowOf('logo.png'));
      expect(modeOf(look()!)).toEqual({ on: 'file', changes: t('quickLook.noChanges'), enabled: false });
      await key('ArrowRight');
      expect(modeOf(look()!).on).toBe('file');
    });

    it('disables Cambios outside a git repository', async () => {
      const { rowOf, space, look, t } = await setup({ ...timmyDisk(), index: null });
      await space(rowOf('README.md'));
      expect(modeOf(look()!)).toEqual({ on: 'file', changes: t('quickLook.noChanges'), enabled: false });
    });

    it('stays on Cambios walking changed files, and falls back to Archivo on an unchanged one', async () => {
      const { sidebar, rowOf, click, space, key, look, shown, t } = await setup(changedDisk());
      // The whole tree: big.log, locked.key, logo.png, README.md at the root, src closed.
      await space(rowOf('README.md'));
      await key('ArrowRight');
      await key('ArrowUp');
      // logo.png: changed but binary, so back to Archivo.
      expect(modeOf(look()!).on).toBe('file');
      await key('Escape');

      await click(sidebar().querySelector('.section button.section-count'));
      await space(rowOf('main.ts'));
      await key('ArrowRight');
      expect(diffShown(look()!)).toEqual(['@@ -1,2 +0,0 @@', '−|1||const a = 1;', '−|2||const b = 2;']);
      await key('ArrowDown');
      expect(shown()?.name).toBe('util.ts');
      expect(modeOf(look()!).on).toBe('changes');
      expect(diffShown(look()!)).toEqual(['@@ -0,0 +1,1 @@', '+||1|export const twice = 2;']);
      await key('ArrowDown');
      expect(shown()?.name).toBe('logo.png');
      expect(modeOf(look()!)).toEqual({ on: 'file', changes: t('quickLook.noChanges'), enabled: false });
      expect(shown()?.text).toBe(t('reader.binary', { size: '4.0 KB' }));
    });

    it('shows a deleted file as gone in Archivo and fully removed in Cambios', async () => {
      const { sidebar, rowOf, click, space, key, look, shown, t } = await setup({ ...changedDisk(), files: { 'README.md': text('x') } });
      await click(sidebar().querySelector('.section button.section-count'));
      await space(rowOf('main.ts'));
      expect(shown()?.text).toBe(t('files.gone'));
      expect(modeOf(look()!).enabled).toBe(true);
      await key('ArrowRight');
      expect(diffShown(look()!)).toEqual(['@@ -1,2 +0,0 @@', '−|1||const a = 1;', '−|2||const b = 2;']);
    });

    it('reads the diff again when it opens and on each step of its walk', async () => {
      const { backend, rowOf, space, key, look } = await setup(changedDisk());
      await space(rowOf('README.md'));
      backend.files.disks[timmy.cwd].diffs!['README.md'] = hunkOf('+now different');
      await key('ArrowUp');
      await key('ArrowDown');
      await key('ArrowRight');
      expect(diffShown(look()!)).toEqual(['@@ -0,0 +1,1 @@', '+||1|now different']);
      expect(backend.files.calls.filter((call) => call === 'Files.diff:README.md')).toHaveLength(2);
    });

    it('labels the changed lines for assistive technology, not by colour alone', async () => {
      const { rowOf, space, key, look, t } = await setup(changedDisk());
      await space(rowOf('README.md'));
      await key('ArrowRight');
      const rows = Array.from(look()!.querySelectorAll('app-file-diff .row'));
      expect(rows.at(-1)?.querySelector('.sign')?.getAttribute('aria-label')).toBe(t('fileDiff.added'));
      expect(rows.at(-2)?.querySelector('.sign')?.getAttribute('aria-label')).toBe(t('fileDiff.removed'));
      expect(look()!.querySelector('app-file-diff [role=region]')?.getAttribute('aria-label')).toBe(t('fileDiff.label', { name: 'README.md' }));
    });
  });

  it('is not a View: the layout of the Tab stays as it was and no file is open in it', async () => {
    const { rowOf, space, key, withTab, panes, look } = await setup();
    const terminal = await withTab();
    await space(rowOf('README.md'));
    expect(look()).not.toBeNull();
    expect(panes()).toHaveLength(1);
    const tabs = TestBed.inject(TabsState);
    const tab = tabs.tabsOf(timmy.projectId).find((each) => each.id === terminal.tabId)!;
    expect(tabs.filesOf(tab)).toEqual([]);
    await key('Escape');
    expect(panes()).toHaveLength(1);
    expect(tabs.filesOf(tab)).toEqual([]);
  });
});
