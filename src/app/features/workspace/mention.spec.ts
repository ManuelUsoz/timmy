import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Effect, Layer, PubSub, Stream } from 'effect';
import type { NotificationEvent, TerminalStatus } from '../../../shared/notification/notification.model';
import { NotificationRpcs } from '../../../shared/notification/notification.rpc';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { TerminalError } from '../../../shared/terminal/terminal-error.model';
import { TerminalRpcs } from '../../../shared/terminal/terminal.rpc';
import { makeDesktopTestLayer, terminalUnusedHandlers } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ToastService } from '../../core/toast';
import { LineSelections } from './line-selection';
import { panesOf } from './pane-layout';
import { PaneStack } from './pane-stack';
import { ProjectsState } from './projects-state';
import { layerFakeBackend, layerFakeWorkspace, makeBackend, project } from './projects-fakes';
import type { TabId } from './tabs';
import { TabsState } from './tabs-state';
import { TerminalId, type TerminalEntry } from './terminal-entries';
import { TerminalsState } from './terminals-state';
import { terminalView } from './views';

const timmy = project('timmy');
const ascua = project('ascua');

@Component({ template: '' })
class Blank {}

/** Every Pane of one Tab, as the grid would lay them out (here one after another). */
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
  readonly tabId = input<TabId>();
  readonly tab = computed(() => this.tabs.tabsOf(timmy.projectId).find((tab) => tab.id === this.tabId()));
  readonly layout = computed(() => {
    const tab = this.tab();
    return tab === undefined ? undefined : this.tabs.layoutOf(tab);
  });
  readonly panes = computed(() => {
    const layout = this.layout();
    return layout === undefined ? [] : panesOf(layout);
  });
}

/**
 * A Tab of timmy with a Provider Terminal ("claude 1") and a preview File View of `path` beside it. Main records what is
 * written to each Terminal; the Notification bus says what each Hook reports.
 */
const setup = async (path = 'src/a.ts', provider: Provider | 'shell' = 'ClaudeCode') => {
  const bus = Effect.runSync(PubSub.unbounded<NotificationEvent>());
  const backend = makeBackend({ projects: [timmy, ascua] });
  backend.files.disks['/work/timmy'] = { dirs: { '': [] }, files: { [path]: { kind: 'text', content: Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n') + '\n' } }, index: [] };
  const written: Array<{ readonly terminalId: string; readonly data: string }> = [];
  let created = 0;
  /** Makes main fail to write, as a Terminal whose process just ended would. */
  const main = { writeFails: false };
  const layer = makeDesktopTestLayer(
    Layer.mergeAll(
      layerFakeBackend(backend),
      layerFakeWorkspace(backend),
      NotificationRpcs.toLayer({ 'Notification.subscribe': () => Stream.fromPubSub(bus) }),
      TerminalRpcs.toLayer({
        ...terminalUnusedHandlers,
        'Terminal.create': () => Effect.sync(() => ({ terminalId: TerminalId.make(`t-${++created}`) })),
        'Terminal.write': ({ terminalId, data }) =>
          main.writeFails ? Effect.fail(new TerminalError({ reason: 'NotFound', detail: terminalId })) : Effect.sync(() => void written.push({ terminalId, data })),
        'Terminal.show': () => Effect.void,
        'Terminal.focus': () => Effect.void,
        'Terminal.activity': () => Stream.never,
      }),
    ),
  );
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [
      provideRouter([{ path: '**', component: Blank }]),
      { provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } },
    ],
  }).compileComponents();
  const terminals = TestBed.inject(TerminalsState);
  const tabs = TestBed.inject(TabsState);
  await TestBed.inject(ProjectsState).refresh();
  const open = async (projectId: ProjectId, provider?: Provider, tabId?: TabId): Promise<TerminalEntry> =>
    (await terminals.createLive(projectId, `/work/${projectId}`, provider, tabId))!;
  const claude = await open(timmy.projectId, provider === 'shell' ? undefined : provider);
  const tabOf = (id: TabId) => tabs.tabsOf(timmy.projectId).find((tab) => tab.id === id)!;
  terminals.setCurrent(claude.id);
  tabs.openFile(tabOf(claude.tabId), path);

  const fixture = TestBed.createComponent(Host);
  fixture.componentRef.setInput('tabId', claude.tabId);
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

  const filePane = () => Array.from(el.querySelectorAll<HTMLElement>('app-pane-stack')).find((pane) => pane.querySelector('app-file-view') !== null)!;
  const header = () => filePane().querySelector<HTMLElement>('.view-header.act')!;
  const popover = () => filePane().querySelector<HTMLElement>('.line-actions');
  const click = async (element: HTMLElement | null | undefined) => {
    if (element == null) throw new Error('nothing to click');
    element.click();
    await settle();
  };
  /** The header's Mencionar, which mentions into the default Terminal. */
  const mentionButton = (place: HTMLElement = header()) => place.querySelector<HTMLButtonElement>('.mention .mention-go')!;
  /** Opens the picker of a Mencionar and gives its rows as they read. */
  const openPicker = async (place: HTMLElement = header()) => {
    await click(place.querySelector<HTMLButtonElement>('.mention .mention-pick'));
    return pickerRows(place);
  };
  const pickerRows = (place: HTMLElement = header()) => Array.from(place.querySelectorAll<HTMLButtonElement>('.mention [role=menu] [role=menuitem]'));
  const rowText = (row: HTMLElement) => row.textContent?.replace(/\s+/g, ' ').trim();
  const say = async (terminalId: TerminalId, type: TerminalStatus) => {
    await Effect.runPromise(PubSub.publish(bus, { _tag: 'Notified', notification: { source: { _tag: 'Terminal', terminalId }, type, seen: false, onScreen: false } }));
    await settle();
  };
  const select = async (start: number, end = start) => {
    TestBed.inject(LineSelections).select(claude.tabId, path, start, end);
    await settle();
  };
  return { main, el, fixture, terminals, tabs, claude, open, tabOf, written, settle, filePane, header, popover, click, mentionButton, openPicker, pickerRows, rowText, say, select };
};

describe('Mencionar a file into an agent (GLOSSARY: Mention)', () => {
  it('types a reference to the whole file into the Provider Terminal from the header, with no Enter', async () => {
    const { claude, written, click, mentionButton } = await setup('src/a.ts');
    await click(mentionButton());
    expect(written).toEqual([{ terminalId: claude.id, data: '@src/a.ts ' }]);
  });

  describe('types what each Provider reads, one line with no control bytes and one trailing space', () => {
    const cases: ReadonlyArray<readonly [Provider, string, string, string, string]> = [
      // Provider, whole file, lines 9-14, one line, a path with spaces and lines
      ['ClaudeCode', '@src/a.ts ', '@src/a.ts#9-14 ', '@src/a.ts#9 ', '@"my dir/a b.ts"#9-14 '],
      ['Codex', 'src/a.ts ', 'src/a.ts:9-14 ', 'src/a.ts:9 ', '"my dir/a b.ts":9-14 '],
      ['OpenCode', '@src/a.ts ', '@src/a.ts#9-14 ', '@src/a.ts#9 ', '"my dir/a b.ts"#9-14 '],
    ];
    for (const [provider, whole, range, single, spaced] of cases) {
      it(`${provider}: ${JSON.stringify([whole, range, single])}`, async () => {
        const { written, click, mentionButton, popover, select } = await setup('src/a.ts', provider);
        await click(mentionButton());
        await select(9, 14);
        await click(mentionButton(popover()!));
        await select(9);
        await click(mentionButton(popover()!));
        expect(written.map((each) => each.data)).toEqual([whole, range, single]);
        for (const { data } of written) expect(data).not.toMatch(/[\u0000-\u001f\u007f]/);
      });

      it(`${provider}: quotes a path with spaces, ${JSON.stringify(spaced)}`, async () => {
        const { written, click, mentionButton, popover, select } = await setup('my dir/a b.ts', provider);
        await select(9, 14);
        await click(mentionButton(popover()!));
        expect(written.map((each) => each.data)).toEqual([spaced]);
      });
    }
  });

  it('mentions the whole file from the header even when a Line selection exists', async () => {
    const { claude, written, click, mentionButton, popover, select } = await setup();
    await select(2, 3);
    await click(mentionButton());
    await click(mentionButton(popover()!));
    expect(written).toEqual([
      { terminalId: claude.id, data: '@src/a.ts ' },
      { terminalId: claude.id, data: '@src/a.ts#2-3 ' },
    ]);
  });

  it('adds to what is already in the prompt: Mentions accumulate, nothing is cleared or pressed', async () => {
    const { claude, written, click, mentionButton, popover, select } = await setup();
    await click(mentionButton());
    await select(2, 3);
    await click(mentionButton(popover()!));
    expect(written).toEqual([
      { terminalId: claude.id, data: '@src/a.ts ' },
      { terminalId: claude.id, data: '@src/a.ts#2-3 ' },
    ]);
  });

  it('offers only the live agents of the Project, as name · #n · Project · status, never a plain shell or another Project', async () => {
    const { claude, open, openPicker, rowText, say } = await setup();
    await open(timmy.projectId);
    const codex = await open(timmy.projectId, 'Codex', claude.tabId);
    await open(ascua.projectId, 'ClaudeCode');
    await say(codex.id, 'Working');
    const rows = await openPicker();
    expect(rows.map(rowText)).toEqual(['claude 1 · #1 · timmy · Idle', 'codex 3 · #3 · timmy · Working']);
  });

  it('goes to the agent focused last, which the picker starts on; a pick there is for that one Mention only', async () => {
    const { el, claude, terminals, open, written, click, mentionButton, openPicker, settle } = await setup();
    const codex = await open(timmy.projectId, 'Codex');
    terminals.setCurrent(codex.id);
    terminals.setCurrent(claude.id);
    await settle();
    expect(mentionButton().getAttribute('aria-label')).toBe('Mencionar en claude 1 · #1');
    const rows = await openPicker();
    expect(document.activeElement).toBe(rows[0]);
    await click(rows[1]);
    expect(el.querySelector('.mention [role=menu]')).toBeNull();
    await click(mentionButton());
    expect(written).toEqual([
      { terminalId: codex.id, data: 'src/a.ts ' },
      { terminalId: claude.id, data: '@src/a.ts ' },
    ]);
  });

  it('is disabled with the reason when the Project has no agent open, and opens none', async () => {
    const { terminals, written, mentionButton, header } = await setup('src/a.ts', 'shell');
    expect(mentionButton().disabled).toBe(true);
    expect(mentionButton().getAttribute('title')).toBe('No hay ningún agente abierto en este proyecto: abre una terminal con un agente');
    expect(header().querySelector<HTMLButtonElement>('.mention .mention-pick')!.disabled).toBe(true);
    expect(terminals.entries()).toHaveLength(1);
    expect(written).toEqual([]);
  });

  it('never types into an agent whose Hook says Waiting: its row is disabled and it is never the default', async () => {
    const { claude, terminals, open, written, click, mentionButton, openPicker, pickerRows, rowText, say, settle } = await setup();
    await say(claude.id, 'Waiting');
    expect(mentionButton().disabled).toBe(true);
    expect(mentionButton().getAttribute('title')).toBe('Los agentes de este proyecto esperan un permiso');
    const codex = await open(timmy.projectId, 'Codex');
    terminals.setCurrent(claude.id);
    await settle();
    const rows = await openPicker();
    expect(rows.map(rowText)).toEqual(['claude 1 · #1 · timmy · espera un permiso', 'codex 2 · #2 · timmy · Idle']);
    expect(rows[0].disabled).toBe(true);
    await click(rows[0]);
    expect(written).toEqual([]);
    expect(pickerRows()).toHaveLength(2);
    expect(document.activeElement).toBe(rows[1]);
    await click(rows[1]);
    expect(written).toEqual([{ terminalId: codex.id, data: 'src/a.ts ' }]);
  });

  it('types at once into an agent that is Working, Done or has no Hook', async () => {
    const { claude, written, click, mentionButton, say } = await setup();
    await say(claude.id, 'Working');
    await click(mentionButton());
    await say(claude.id, 'Done');
    await click(mentionButton());
    expect(written.map((each) => each.terminalId)).toEqual([claude.id, claude.id]);
  });

  it('then puts the user on the agent, switching Tab, and says where it went; the reader and its Line selection stay', async () => {
    const { claude, tabs, tabOf, open, click, mentionButton, popover, select } = await setup();
    const codex = await open(timmy.projectId, 'Codex');
    TestBed.inject(TerminalsState).setCurrent(codex.id);
    await select(4, 5);
    await click(mentionButton(popover()!));
    expect(TestBed.inject(Router).url).toBe(`/projects/${timmy.projectId}/terminals/${codex.id}`);
    const layout = tabs.layoutOf(tabOf(codex.tabId))!;
    expect(panesOf(layout).find((pane) => pane.id === layout.focused)?.expanded).toEqual(terminalView(codex.id));
    expect(TestBed.inject(ToastService).toasts().map((toast) => [toast.body, toast.params])).toEqual([['mention.done', { name: 'codex 2', number: 2 }]]);
    expect(tabs.filesOf(tabOf(claude.tabId))).toEqual([{ path: 'src/a.ts', pinned: false }]);
    expect(TestBed.inject(LineSelections).of(claude.tabId, 'src/a.ts')).toEqual({ anchor: 4, start: 4, end: 5 });
  });

  it('in the same Tab, brings the agent forward in its Pane and focuses that Pane', async () => {
    const { claude, tabs, tabOf, click, mentionButton } = await setup();
    await click(mentionButton());
    const layout = tabs.layoutOf(tabOf(claude.tabId))!;
    expect(panesOf(layout).find((pane) => pane.id === layout.focused)?.expanded).toEqual(terminalView(claude.id));
  });

  it('says so when main cannot write it, and leaves the user where they were', async () => {
    const { main, claude, click, mentionButton } = await setup();
    const router = TestBed.inject(Router);
    main.writeFails = true;
    await click(mentionButton());
    expect(TestBed.inject(ToastService).toasts().map((toast) => [toast.tone, toast.body])).toEqual([['error', 'mention.failed']]);
    expect(router.url).not.toContain(claude.id);
  });
});
