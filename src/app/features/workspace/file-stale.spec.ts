import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Effect, Layer, PubSub, Stream } from 'effect';
import { TerminalId, type TerminalHookReport } from '../../../shared/terminal/terminal.model';
import { TerminalRpcs } from '../../../shared/terminal/terminal.rpc';
import { makeDesktopTestLayer, terminalUnusedHandlers } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { CHANGES_DEBOUNCE_MS } from './files-browser';
import { rewrite, text } from './files-fakes';
import { LineSelections } from './line-selection';
import { panesOf } from './pane-layout';
import { PaneStack } from './pane-stack';
import { layerFakeBackend, layerFakeWorkspace, makeBackend, project } from './projects-fakes';
import { TabsState } from './tabs-state';
import { TerminalsState } from './terminals-state';

const timmy = project('timmy');
const CWD = '/work/timmy';
const DEBOUNCE = 5;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const lines = (count: number, prefix = 'line') => Array.from({ length: count }, (_, i) => `${prefix} ${i + 1}`).join('\n') + '\n';

@Component({
  imports: [PaneStack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tab(); as tab) {
      @for (pane of panes(); track pane.id) {
        <app-pane-stack [tab]="tab" [pane]="pane" cwd="/work/timmy" [focused]="pane.id === layout()?.focused" [canSplitRight]="true" />
      }
    }
  `,
})
class Host {
  private readonly tabs = inject(TabsState);
  readonly tab = computed(() => this.tabs.tabsOf(timmy.projectId)[0]);
  readonly layout = computed(() => {
    const tab = this.tab();
    return tab === undefined ? undefined : this.tabs.layoutOf(tab);
  });
  readonly panes = computed(() => {
    const layout = this.layout();
    return layout === undefined ? [] : panesOf(layout);
  });
}

/** A Tab of timmy with a File View of `src/a.ts` (20 lines) and of `src/b.ts` pinned beside it, on a disk the tests change. */
const setup = async (files: Record<string, string> = { 'src/a.ts': lines(20), 'src/b.ts': lines(3, 'other') }, open: ReadonlyArray<string> = ['src/a.ts']) => {
  const backend = makeBackend({ projects: [timmy] });
  backend.files.disks[CWD] = { dirs: { '': [] }, files: Object.fromEntries(Object.entries(files).map(([path, content]) => [path, text(content)])), index: [] };
  /** What the Hooks of every Terminal report. */
  const hooks = Effect.runSync(PubSub.unbounded<TerminalHookReport>());
  const layer = makeDesktopTestLayer(
    Layer.mergeAll(
      layerFakeBackend(backend),
      layerFakeWorkspace(backend),
      TerminalRpcs.toLayer({ ...terminalUnusedHandlers, 'Terminal.hookReports': () => Stream.fromPubSub(hooks) }),
    ),
  );
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      { provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } },
      { provide: CHANGES_DEBOUNCE_MS, useValue: DEBOUNCE },
    ],
  }).compileComponents();
  const tabs = TestBed.inject(TabsState);
  // The Tab starts with one Terminal, as New Tab makes it.
  TestBed.inject(TerminalsState).create(timmy.projectId);
  const fixture = TestBed.createComponent(Host);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
  };
  fixture.detectChanges();
  await settle();
  const tab = () => tabs.tabsOf(timmy.projectId)[0];
  for (const path of open) tabs.openFile(tab(), path, true);
  await settle();

  const disk = backend.files.disks[CWD]!;
  const fake = backend.files;
  const asks = () => fake.calls.filter((call) => call.startsWith('Files.versions'));
  const view = (path = 'src/a.ts') => Array.from(el.querySelectorAll<HTMLElement>('app-pane-stack')).find((pane) => pane.querySelector(`.view-header.act [title="${path}"]`) !== null)!;
  const header = (path?: string) => view(path).querySelector<HTMLElement>('.view-header.act')!;
  const bar = (path?: string) => view(path).querySelector<HTMLElement>('.notice');
  const shown = (path?: string) => [...view(path).querySelectorAll('.line .text')].map((line) => line.textContent);
  const click = async (element: HTMLElement | null | undefined) => {
    if (element == null) throw new Error('nothing to click');
    element.click();
    await settle();
  };
  /** An agent (or the user, elsewhere) changes the file, then the Project's triggers fire. */
  const change = async (path: string, content: string) => {
    rewrite(fake, CWD, path, content);
  };
  const hook = async (signal: 'Working' | 'Done' | 'Waiting' = 'Working') => {
    await Effect.runPromise(PubSub.publish(hooks, { terminalId: TerminalId.make('t-1'), signal }));
    await wait(DEBOUNCE * 4);
    await settle();
  };
  const focusWindow = async () => {
    window.dispatchEvent(new Event('focus'));
    await wait(DEBOUNCE * 4);
    await settle();
  };
  const select = async (start: number, end = start, path = 'src/a.ts') => {
    TestBed.inject(LineSelections).select(tab().id, path, start, end);
    await settle();
  };
  const marked = (path?: string) => view(path).querySelector<HTMLElement>('.marks .selected');
  const popover = (path?: string) => view(path).querySelector<HTMLElement>('.line-actions');
  const scroller = (path?: string) => view(path).querySelector<HTMLElement>('.scroll')!;
  const popoverButton = (label: string) => Array.from(popover()!.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.trim() === label)!;
  return { fake, disk, asks, view, header, bar, shown, click, change, hook, focusWindow, select, marked, popover, scroller, popoverButton, settle, tab };
};

describe('A Stale File View', () => {
  it('shows no bar while the file on disk is the one on screen, however many triggers come', async () => {
    const { bar, hook, focusWindow } = await setup();
    await hook();
    await focusWindow();
    expect(bar()).toBeNull();
  });

  it('says the file changed on disk, with Recargar, on a Hook that says an agent used a tool, and never replaces the text itself', async () => {
    const { bar, shown, change, hook } = await setup();
    expect(shown()).toHaveLength(20);
    await change('src/a.ts', lines(5, 'new'));
    await hook('Done');
    expect(bar()?.textContent).toContain('El archivo cambió en disco');
    expect(bar()?.querySelector('button')?.textContent?.trim()).toBe('Recargar');
    expect(shown()).toHaveLength(20);
    expect(shown()[0]).toBe('line 1');
  });

  it('is told by the window taking the focus too', async () => {
    const { bar, change, focusWindow } = await setup();
    await change('src/a.ts', 'changed\n');
    await focusWindow();
    expect(bar()).not.toBeNull();
  });

  it('is not told by a Hook that is neither a tool use nor a stop', async () => {
    const { bar, change, hook } = await setup();
    await change('src/a.ts', 'changed\n');
    await hook('Waiting');
    expect(bar()).toBeNull();
  });

  it('asks once per trigger for every open File View, bursts of triggers being one question', async () => {
    const { asks, change, hook, focusWindow } = await setup(undefined, ['src/a.ts', 'src/b.ts']);
    const before = asks().length;
    await change('src/a.ts', 'x\n');
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    await wait(DEBOUNCE * 4);
    expect(asks().slice(before)).toEqual(['Files.versions:src/a.ts,src/b.ts']);
    await hook();
    await focusWindow();
    expect(asks().slice(before)).toHaveLength(3);
  });

  it('checks a View that takes the focus', async () => {
    const { view, asks, change, bar, settle } = await setup();
    await change('src/a.ts', 'changed\n');
    view().querySelector<HTMLElement>('.scroll')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await wait(DEBOUNCE * 4);
    await settle();
    expect(asks().length).toBeGreaterThan(1);
    expect(bar()).not.toBeNull();
  });

  it('checks a View when it becomes visible: one opened after the file changed reads the new text and shows no bar', async () => {
    const { change, tab, settle, bar } = await setup(undefined, []);
    await change('src/b.ts', lines(2, 'fresh'));
    TestBed.inject(TabsState).openFile(tab(), 'src/b.ts', true);
    await settle();
    expect(bar('src/b.ts')).toBeNull();
  });

  it('Recargar reads the file again, keeps the scroll and the Line selection by line number, and removes the bar', async () => {
    const { bar, shown, change, hook, select, scroller, click, marked, view } = await setup();
    await select(3, 5);
    scroller().scrollTop = 40;
    await change('src/a.ts', lines(30, 'new'));
    await hook();
    expect(marked()).not.toBeNull();
    await click(bar()!.querySelector('button'));
    expect(shown()).toHaveLength(30);
    expect(shown()[0]).toBe('new 1');
    expect(bar()).toBeNull();
    expect(scroller().scrollTop).toBe(40);
    expect(marked()?.style.top).toBe(`${2 * 18}px`);
    expect(marked()?.style.height).toBe(`${3 * 18}px`);
    expect(view().querySelector('.line-actions .range')?.textContent).toBe('3-5');
  });

  it('keeps the Line selection on the last line when the reloaded file got shorter, and drops it when it starts past the end', async () => {
    const { bar, change, hook, select, click, marked, view } = await setup();
    await select(8, 12);
    await change('src/a.ts', lines(10));
    await hook();
    await click(bar()!.querySelector('button'));
    expect(view().querySelector('.line-actions .range')?.textContent).toBe('8-10');
    await select(9, 10);
    await change('src/a.ts', lines(4));
    await hook();
    await click(bar()!.querySelector('button'));
    expect(marked()).toBeNull();
  });

  it('is stale again only after another change, not after the reload', async () => {
    const { bar, change, hook, click } = await setup();
    await change('src/a.ts', 'one\n');
    await hook();
    await click(bar()!.querySelector('button'));
    await hook();
    expect(bar()).toBeNull();
    await change('src/a.ts', 'two\n');
    await hook();
    expect(bar()).not.toBeNull();
  });

  it('disables Mencionar and Copiar ruta of the Line selection with "Recarga el archivo primero" while stale, and nothing else', async () => {
    const { header, popover, popoverButton, change, hook, select, view } = await setup();
    await select(3, 5);
    expect(popoverButton('Copiar ruta').disabled).toBe(false);
    await change('src/a.ts', lines(20, 'new'));
    await hook();
    expect(popoverButton('Copiar ruta').disabled).toBe(true);
    expect(popoverButton('Copiar ruta').title).toBe('Recarga el archivo primero');
    expect(popoverButton('Copiar').disabled).toBe(false);
    const mention = popover()!.querySelector<HTMLButtonElement>('.mention-go')!;
    expect(mention.disabled).toBe(true);
    expect(mention.title).toBe('Recarga el archivo primero');
    // The header: Copiar ruta names a range with a selection, so it is off too; Copiar and Abrir are not.
    const labelled = (label: string) => header().querySelector<HTMLButtonElement>(`.file-actions button[aria-label="${label}"]`)!;
    expect(labelled('Copiar ruta').disabled).toBe(true);
    expect(labelled('Copiar').disabled).toBe(false);
    expect(labelled('Abrir en el editor externo').disabled).toBe(false);
    expect(view().querySelector('.mention .mention-pick')).not.toBeNull();
  });

  it('lets Copiar ruta of the path alone be, and enables everything again after Recargar', async () => {
    const { header, change, hook, click, bar, select, popoverButton } = await setup();
    await change('src/a.ts', lines(20, 'new'));
    await hook();
    expect(header().querySelector<HTMLButtonElement>('.file-actions button[aria-label="Copiar ruta"]')!.disabled).toBe(false);
    await select(2, 3);
    expect(popoverButton('Copiar ruta').disabled).toBe(true);
    await click(bar()!.querySelector('button'));
    expect(popoverButton('Copiar ruta').disabled).toBe(false);
  });
});

describe('A File View of a file that is gone', () => {
  it('keeps its last text, dimmed, under a bar that says it no longer exists, with no Recargar, and strikes the Tab title', async () => {
    const { disk, bar, shown, hook, header, scroller } = await setup();
    delete disk.files['src/a.ts'];
    await hook();
    expect(bar()?.textContent).toContain('ya no existe');
    expect(bar()?.querySelector('button')).toBeNull();
    expect(shown()).toHaveLength(20);
    expect(scroller().classList).toContain('dimmed');
    expect(header().querySelector('.name')?.classList).toContain('gone');
  });

  it('disables Mencionar (header and Line selection) and Copiar ruta with a range, but not copying the text or the path alone', async () => {
    const { disk, header, popoverButton, popover, hook, select } = await setup();
    await select(2, 4);
    delete disk.files['src/a.ts'];
    await hook();
    expect(header().querySelector<HTMLButtonElement>('.mention .mention-go')!.disabled).toBe(true);
    expect(popover()!.querySelector<HTMLButtonElement>('.mention-go')!.disabled).toBe(true);
    expect(popoverButton('Copiar').disabled).toBe(false);
    expect(popoverButton('Copiar ruta').disabled).toBe(false);
    expect(header().querySelector<HTMLButtonElement>('.file-actions button[aria-label="Copiar"]')!.disabled).toBe(false);
  });

  it('turns into the normal stale hint when the path comes back, with the same version too', async () => {
    const { disk, bar, shown, hook, click, header } = await setup();
    const kept = disk.files['src/a.ts']!;
    delete disk.files['src/a.ts'];
    await hook();
    expect(bar()?.textContent).toContain('ya no existe');
    disk.files['src/a.ts'] = kept;
    await hook();
    expect(bar()?.textContent).toContain('El archivo cambió en disco');
    expect(header().querySelector('.name')?.classList).not.toContain('gone');
    await click(bar()!.querySelector('button'));
    expect(bar()).toBeNull();
    expect(shown()).toHaveLength(20);
  });

  it('keeps the last text when the file is deleted while Recargar reads it', async () => {
    const { disk, bar, shown, change, hook, click } = await setup();
    await change('src/a.ts', 'x\n');
    await hook();
    const reloading = click(bar()!.querySelector('button'));
    delete disk.files['src/a.ts'];
    await reloading;
    await hook();
    expect(bar()?.textContent).toContain('ya no existe');
    expect(shown()).toHaveLength(20);
  });

  it('shows only the empty gone state for a View opened on a missing path, until the path appears', async () => {
    const { bar, view, disk, hook, click, shown } = await setup({ 'src/b.ts': 'b\n' }, ['src/missing.ts']);
    expect(view('src/missing.ts').querySelector('.note')?.textContent).toContain('ya no existe');
    expect(bar('src/missing.ts')).toBeNull();
    await hook();
    expect(bar('src/missing.ts')).toBeNull();
    disk.files['src/missing.ts'] = text('hello\n');
    await hook();
    expect(bar('src/missing.ts')?.textContent).toContain('El archivo cambió en disco');
    await click(bar('src/missing.ts')!.querySelector('button'));
    expect(shown('src/missing.ts')).toEqual(['hello']);
  });
});
