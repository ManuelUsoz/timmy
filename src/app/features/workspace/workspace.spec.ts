import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Effect, Layer, PubSub, Ref, Stream } from 'effect';
import type { NotificationEvent, TerminalStatus } from '../../../shared/notification/notification.model';
import { NotificationRpcs } from '../../../shared/notification/notification.rpc';
import { defaultChannels, type Language } from '../../../shared/settings/settings.model';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import type { TerminalId } from './terminal-entries';
import { layerFakeProjects, makeBackend, project } from './projects-fakes';
import { addToStack, panesOf, split } from './pane-layout';
import { TabsState } from './tabs-state';
import { TerminalsState } from './terminals-state';
import { WorkspaceComponent } from './workspace';
import { WorkspaceLayoutState } from './workspace-layout';
import { provideWorkspaceRouter } from './workspace.routes';

const timmy = project('timmy', { lastUsedAt: 2 });
const ascua = project('ascua', { lastUsedAt: 1 });

/** Two projects, timmy used last, so the Workspace opens it. */
const setup = async (width = 1400, backend = makeBackend({ projects: [timmy, ascua] })) => {
  const stored = Ref.makeUnsafe<Language>('es');
  const bus = Effect.runSync(PubSub.unbounded<NotificationEvent>());
  const handlers = Layer.mergeAll(
    SettingsRpcs.toLayer({
      'Settings.get': () => Effect.map(Ref.get(stored), (language) => ({ language, providers: [], channels: defaultChannels })),
      'Settings.setProvider': () => Effect.die('unused'),
      'Settings.setChannel': () => Effect.die('unused'),
      'Settings.setLanguage': ({ language }) => Ref.set(stored, language).pipe(Effect.as({ language, providers: [], channels: defaultChannels })),
    }),
    NotificationRpcs.toLayer({ 'Notification.subscribe': () => Stream.fromPubSub(bus) }),
    layerFakeProjects(backend),
  );
  const layer = makeDesktopTestLayer(handlers);
  await TestBed.configureTestingModule({
    imports: [WorkspaceComponent],
    providers: [
      provideWorkspaceRouter(),
      {
        provide: EffectRuntime,
        useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) },
      },
    ],
  }).compileComponents();
  const layoutState = TestBed.inject(WorkspaceLayoutState);
  layoutState.width.set(width);
  const fixture = TestBed.createComponent(WorkspaceComponent);
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
  const sidebar = () => el.querySelector<HTMLElement>('app-workspace-sidebar')!;
  const settings = () => sidebar().querySelector<HTMLButtonElement>('button.settings')!;
  const dialog = () => el.querySelector<HTMLElement>('app-settings-dialog');
  const key = async (init: KeyboardEventInit) => {
    const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
    document.body.dispatchEvent(event);
    await settle();
    return event;
  };
  const say = async (terminalId: TerminalId, type: TerminalStatus) => {
    Effect.runSync(PubSub.publish(bus, { _tag: 'Notified', notification: { source: { _tag: 'Terminal', terminalId }, type, seen: false, onScreen: false } }));
    await settle();
  };
  const terminalRows = () => Array.from(sidebar().querySelectorAll<HTMLElement>('[role=listbox].terminals as-list-row'));
  return { el, settle, sidebar, settings, dialog, key, say, terminalRows, layoutState, stored };
};

describe('WorkspaceComponent', () => {
  it('has no rail: the sidebar holds Projects, Terminals and Settings, and entering lands on the Project used last', async () => {
    const { el, sidebar, settings } = await setup();
    expect(el.querySelector('nav.rail')).toBeNull();
    expect(Array.from(sidebar().querySelectorAll('.section-label')).map((label) => label.textContent?.trim())).toEqual(['Proyectos', 'Terminales']);
    expect(settings().textContent).toContain('Ajustes');
    expect(Array.from(settings().querySelectorAll('kbd')).map((k) => k.textContent)).toEqual(['Ctrl', ',']);
    expect(el.querySelector('app-projects-screen')).not.toBeNull();
    expect(sidebar().querySelector('app-project-list as-list-row[aria-current=true] .as-row__title')?.textContent?.trim()).toBe('timmy');
  });

  it('names each Project with its avatar and keeps its path in a tooltip only', async () => {
    const { sidebar } = await setup();
    const row = Array.from(sidebar().querySelectorAll<HTMLElement>('app-project-list as-list-row')).find((r) => r.textContent?.includes('ascua'))!;
    expect(row.querySelector('.tile')?.textContent?.trim()).toBe('A');
    expect(row.getAttribute('title')).toBe('/work/ascua');
    expect(row.textContent).not.toContain('/work/ascua');
  });

  it('opens Settings over the screen from the footer, which stays underneath, and closes it from the footer again', async () => {
    const { el, settings, dialog, settle } = await setup();
    expect(settings().getAttribute('aria-haspopup')).toBe('dialog');
    expect(settings().getAttribute('aria-expanded')).toBe('false');
    settings().click();
    await settle();
    expect(dialog()).not.toBeNull();
    expect(settings().getAttribute('aria-expanded')).toBe('true');
    expect(el.querySelector('app-projects-screen')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe('/projects/p-timmy');
    settings().click();
    await settle();
    expect(dialog()).toBeNull();
  });

  it('opens and closes Settings with Ctrl+,', async () => {
    const { dialog, key } = await setup();
    const event = await key({ key: ',', ctrlKey: true });
    expect(dialog()).not.toBeNull();
    expect(event.defaultPrevented).toBe(true);
    await key({ key: ',', ctrlKey: true });
    expect(dialog()).toBeNull();
  });

  it('leaves Ctrl+, alone when another modifier is held', async () => {
    const { dialog, key } = await setup();
    const event = await key({ key: ',', ctrlKey: true, shiftKey: true });
    expect(dialog()).toBeNull();
    expect(event.defaultPrevented).toBe(false);
  });

  it('sends the old Settings route to Projects, without opening Settings', async () => {
    const { el, dialog, settle } = await setup();
    await TestBed.inject(Router).navigateByUrl('/settings');
    await settle();
    expect(el.querySelector('app-projects-screen')).not.toBeNull();
    expect(dialog()).toBeNull();
  });

  it('sends the routes of the removed areas to Projects', async () => {
    const { el, settle } = await setup();
    for (const url of ['/chat', '/history']) {
      await TestBed.inject(Router).navigateByUrl(url);
      await settle();
      expect(el.querySelector('app-projects-screen'), url).not.toBeNull();
    }
  });

  it('changes the language from Settings, at once, for the whole Workspace, and stores it', async () => {
    const { el, settings, settle, sidebar, stored } = await setup();
    settings().click();
    await settle();
    const english = Array.from(el.querySelectorAll<HTMLButtonElement>('app-settings-dialog [role="radio"]')).find((b) => b.textContent?.trim() === 'English')!;
    english.click();
    await settle();
    expect(settings().textContent).toContain('Settings');
    expect(sidebar().querySelector('.section-label')?.textContent?.trim()).toBe('Projects');
    expect(el.querySelector('app-settings-dialog [role="dialog"]')?.getAttribute('aria-label')).toBe('Settings');
    expect(Effect.runSync(Ref.get(stored))).toBe('en');
  });

  describe('removing a Project from its context menu', () => {
    const projectRow = (sidebar: HTMLElement, name: string) =>
      Array.from(sidebar.querySelectorAll<HTMLElement>('app-project-list as-list-row')).find((row) => row.textContent?.includes(name))!;
    const rightClick = async (row: HTMLElement, settle: () => Promise<void>) => {
      row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 80 }));
      await settle();
    };
    const menu = (sidebar: HTMLElement) => sidebar.querySelector<HTMLElement>('app-project-list [role=menu]');

    it('removes an open Project, closes its Terminals and goes to another one', async () => {
      const backend = makeBackend({ projects: [timmy, ascua] });
      const { el, sidebar, settle } = await setup(1400, backend);
      TestBed.inject(TerminalsState).create(timmy.projectId);
      await settle();
      await rightClick(projectRow(sidebar(), 'timmy'), settle);
      expect(menu(sidebar())?.getAttribute('aria-label')).toBe('Opciones de timmy');
      const item = menu(sidebar())!.querySelector<HTMLButtonElement>('[role=menuitem]')!;
      expect(item.textContent?.trim()).toBe('Quitar proyecto');
      item.click();
      await settle();
      expect(el.querySelector('ui-modal')).toBeNull();
      expect(backend.calls).toContain('Projects.remove:p-timmy');
      expect(menu(sidebar())).toBeNull();
      expect(Array.from(sidebar().querySelectorAll('app-project-list as-list-row')).map((row) => row.textContent?.trim())).toEqual([expect.stringContaining('ascua')]);
      expect(TestBed.inject(TerminalsState).entries()).toEqual([]);
      expect(TestBed.inject(Router).url).toBe('/projects/p-ascua');
    });

    it('asks first while one of its Terminals is Working, and keeps it on Cancel', async () => {
      const backend = makeBackend({ projects: [timmy, ascua] });
      const { el, sidebar, settle, say } = await setup(1400, backend);
      const terminal = TestBed.inject(TerminalsState).create(ascua.projectId);
      await say(terminal.id, 'Working');
      await rightClick(projectRow(sidebar(), 'ascua'), settle);
      menu(sidebar())!.querySelector<HTMLButtonElement>('[role=menuitem]')!.click();
      await settle();
      const modal = el.querySelector('ui-modal')!;
      expect(modal.querySelector('h2')?.textContent).toBe('¿Quitar ascua?');
      modal.querySelector<HTMLButtonElement>('.dismiss')!.click();
      await settle();
      expect(backend.calls).not.toContain('Projects.remove:p-ascua');
      await rightClick(projectRow(sidebar(), 'ascua'), settle);
      menu(sidebar())!.querySelector<HTMLButtonElement>('[role=menuitem]')!.click();
      await settle();
      el.querySelector<HTMLButtonElement>('ui-modal .primary')!.click();
      await settle();
      expect(backend.calls).toContain('Projects.remove:p-ascua');
      expect(TestBed.inject(TerminalsState).entries()).toEqual([]);
      expect(TestBed.inject(Router).url).toBe('/projects/p-timmy');
    });

    it('closes the menu with Esc, and opens it from the collapsed strip too', async () => {
      const { sidebar, settle, key } = await setup(1100);
      const tile = sidebar().querySelector<HTMLElement>('app-project-list .rail-project')!;
      await rightClick(tile, settle);
      expect(menu(sidebar())).not.toBeNull();
      await key({ key: 'Escape' });
      expect(menu(sidebar())).toBeNull();
    });
  });

  describe('Terminals', () => {
    it('lists every Terminal like the Panel: those that need the user first, then by Project, each with its status', async () => {
      const { terminalRows, say } = await setup();
      const terminals = TestBed.inject(TerminalsState);
      const t1 = terminals.create(timmy.projectId);
      const a1 = terminals.create(ascua.projectId);
      const t2 = terminals.create(timmy.projectId);
      await say(t1.id, 'Working');
      await say(t2.id, 'Waiting');
      await say(a1.id, 'Error');
      expect(terminalRows().map((row) => [row.querySelector('.as-row__title')?.textContent?.trim(), row.querySelector('ui-state')?.textContent?.trim()])).toEqual([
        ['Terminal 2', 'Waiting'],
        ['Terminal 1', 'Error'],
        ['Terminal 1', 'Working'],
      ]);
    });

    it('says how many Terminals a Project has, with the most urgent status', async () => {
      const { sidebar, say } = await setup();
      const terminals = TestBed.inject(TerminalsState);
      const t1 = terminals.create(timmy.projectId);
      terminals.create(timmy.projectId);
      await say(t1.id, 'Done');
      const row = Array.from(sidebar().querySelectorAll<HTMLElement>('app-project-list as-list-row')).find((r) => r.textContent?.includes('timmy'))!;
      expect(row.querySelector('.count')?.textContent?.trim()).toBe('2');
      expect(row.querySelector('.count')?.getAttribute('data-status')).toBe('Done');
      const other = Array.from(sidebar().querySelectorAll<HTMLElement>('app-project-list as-list-row')).find((r) => r.textContent?.includes('ascua'))!;
      expect(other.querySelector('.count')).toBeNull();
    });

    it('opens a Terminal at its own route from its row', async () => {
      const { terminalRows, settle } = await setup();
      const terminal = TestBed.inject(TerminalsState).create(ascua.projectId);
      await settle();
      terminalRows()[0].click();
      await settle();
      expect(TestBed.inject(Router).url).toBe(`/projects/p-ascua/terminals/${terminal.id}`);
    });

    it('reveals a Terminal collapsed in a Stack of another Project: its Pane focused, its View expanded', async () => {
      const { terminalRows, settle, el } = await setup();
      const terminals = TestBed.inject(TerminalsState);
      const tabs = TestBed.inject(TabsState);
      // ascua's Tab holds a Stack of Terminals 1 and 2; Terminal 2 is expanded and the user is looking at timmy.
      const hidden = terminals.create(ascua.projectId);
      const tab = tabs.tabsOf(ascua.projectId)[0];
      await tabs.openInTab(tab, ascua.cwd, undefined, (layout, terminal) => addToStack(layout, layout.focused, terminal));
      await settle();
      expect(panesOf(tabs.layoutOf(tabs.tabsOf(ascua.projectId)[0])!)[0].expanded).not.toBe(hidden.id);

      const row = terminalRows().find((candidate) => candidate.querySelector('.as-row__title')?.textContent?.trim() === 'Terminal 1')!;
      row.click();
      await settle();

      const layout = tabs.layoutOf(tabs.tabsOf(ascua.projectId)[0])!;
      expect(TestBed.inject(Router).url).toBe(`/projects/p-ascua/terminals/${hidden.id}`);
      expect(panesOf(layout)[0].expanded).toBe(hidden.id);
      expect(layout.focused).toBe(panesOf(layout)[0].id);
      expect(el.querySelector('app-pane-stack .view-header.act .name')?.textContent).toBe('Terminal 1');
    });

    it('reveals a Terminal in a Pane that is not focused, in a Tab that is not the open one', async () => {
      const { terminalRows, settle } = await setup();
      const terminals = TestBed.inject(TerminalsState);
      const tabs = TestBed.inject(TabsState);
      const left = terminals.create(timmy.projectId);
      const tab = tabs.tabsOf(timmy.projectId)[0];
      await tabs.openInTab(tab, timmy.cwd, undefined, (layout, terminal) => split(layout, layout.focused, 'right', terminal));
      const other = terminals.create(timmy.projectId);
      await TestBed.inject(Router).navigate(['/projects', timmy.projectId, 'terminals', other.id]);
      await settle();

      terminalRows().find((candidate) => candidate.querySelector('.as-row__title')?.textContent?.trim() === 'Terminal 1')!.click();
      await settle();

      const layout = tabs.layoutOf(tabs.tabsOf(timmy.projectId)[0])!;
      expect(TestBed.inject(Router).url).toBe(`/projects/p-timmy/terminals/${left.id}`);
      expect(layout.focused).toBe(left.id);
      expect(panesOf(layout)).toHaveLength(2);
    });
  });

  describe('collapsing', () => {
    const toggle = (sidebar: HTMLElement) => sidebar.querySelector<HTMLButtonElement>('button.sidebar-toggle')!;

    it('is expanded from xl and collapsed below it', async () => {
      expect((await setup(1400)).sidebar().classList).not.toContain('collapsed');
      TestBed.resetTestingModule();
      expect((await setup(1100)).sidebar().classList).toContain('collapsed');
    });

    it('collapses and expands with Ctrl+B, which the toggle shows inline', async () => {
      const { sidebar, key } = await setup(1400);
      expect(Array.from(toggle(sidebar()).querySelectorAll('kbd')).map((k) => k.textContent)).toEqual(['Ctrl', 'B']);
      const event = await key({ key: 'b', ctrlKey: true });
      expect(event.defaultPrevented).toBe(true);
      expect(sidebar().classList).toContain('collapsed');
      expect(toggle(sidebar()).getAttribute('aria-expanded')).toBe('false');
      await key({ key: 'B', ctrlKey: true });
      expect(sidebar().classList).not.toContain('collapsed');
    });

    it('collapsed, keeps an avatar per Project and Settings, which still work', async () => {
      const { sidebar, settings, dialog, settle } = await setup(1100);
      const tiles = Array.from(sidebar().querySelectorAll<HTMLButtonElement>('app-project-list .rail-project'));
      expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual(['ascua', 'timmy']);
      expect(tiles.map((b) => b.getAttribute('title'))).toEqual(['ascua · /work/ascua', 'timmy · /work/timmy']);
      tiles[0].click();
      await settle();
      expect(TestBed.inject(Router).url).toBe('/projects/p-ascua');
      settings().click();
      await settle();
      expect(dialog()).not.toBeNull();
    });

    it('follows the window as it is resized, until the user collapses it by hand', async () => {
      const { sidebar, settle, layoutState } = await setup(1400);
      layoutState.width.set(1100);
      await settle();
      expect(sidebar().classList).toContain('collapsed');
      layoutState.width.set(1400);
      await settle();
      toggle(sidebar()).click();
      await settle();
      expect(sidebar().classList).toContain('collapsed');
      layoutState.width.set(1500);
      await settle();
      expect(sidebar().classList).toContain('collapsed');
    });
  });

  describe('the Switcher (Ctrl+Tab)', () => {
    /** A Terminal in each Project, visited ascua's first and then timmy's, which stays on screen. */
    const twoTabs = async () => {
      const harness = await setup();
      const terminals = TestBed.inject(TerminalsState);
      const ascuaTerminal = terminals.create(ascua.projectId);
      const timmyTerminal = terminals.create(timmy.projectId);
      const router = TestBed.inject(Router);
      await router.navigateByUrl(`/projects/p-ascua/terminals/${ascuaTerminal.id}`);
      await harness.settle();
      await router.navigateByUrl(`/projects/p-timmy/terminals/${timmyTerminal.id}`);
      await harness.settle();
      const switcher = () => harness.el.querySelector<HTMLElement>('app-switcher');
      const cards = () => Array.from(harness.el.querySelectorAll<HTMLButtonElement>('app-switcher .card'));
      const releaseCtrl = async () => {
        window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true, cancelable: true }));
        await harness.settle();
      };
      return { ...harness, router, terminals, ascuaTerminal, timmyTerminal, switcher, cards, releaseCtrl };
    };

    it('opens with every Tab across Projects, most recent first, on the Tab before this one', async () => {
      const { key, switcher, cards } = await twoTabs();
      const event = await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      expect(event.defaultPrevented).toBe(true);
      expect(switcher()).not.toBeNull();
      expect(cards().map((card) => card.querySelector('.names')?.textContent?.trim())).toEqual(['timmy · Terminal 1', 'ascua · Terminal 1']);
      expect(cards().map((card) => card.getAttribute('aria-selected'))).toEqual(['false', 'true']);
      expect(cards().map((card) => card.querySelector('kbd')?.textContent)).toEqual(['1', '2']);
      expect(cards()[0].querySelector('ui-state')?.textContent?.trim()).toBe('Idle');
    });

    it('goes to the selected Tab when Ctrl is released', async () => {
      const { key, router, switcher, releaseCtrl, ascuaTerminal } = await twoTabs();
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      await releaseCtrl();
      expect(switcher()).toBeNull();
      expect(router.url).toBe(`/projects/p-ascua/terminals/${ascuaTerminal.id}`);
    });

    it('cycles with Ctrl+Tab and Ctrl+Shift+Tab, and Esc cancels where it was', async () => {
      const { key, router, switcher, cards, timmyTerminal } = await twoTabs();
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      expect(cards().map((card) => card.getAttribute('aria-selected'))).toEqual(['true', 'false']);
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true, shiftKey: true });
      expect(cards().map((card) => card.getAttribute('aria-selected'))).toEqual(['false', 'true']);
      await key({ key: 'Escape', code: 'Escape', ctrlKey: true });
      expect(switcher()).toBeNull();
      expect(router.url).toBe(`/projects/p-timmy/terminals/${timmyTerminal.id}`);
    });

    it('jumps straight to a card with its number, instead of going to the Tab of that number', async () => {
      const { key, router, ascuaTerminal } = await twoTabs();
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      const event = await key({ key: '2', code: 'Digit2', ctrlKey: true });
      expect(event.defaultPrevented).toBe(true);
      expect(router.url).toBe(`/projects/p-ascua/terminals/${ascuaTerminal.id}`);
    });

    it('shows the last lines of output of each Tab\'s focused Terminal', async () => {
      const { key, cards, terminals, ascuaTerminal } = await twoTabs();
      terminals.attachTail(ascuaTerminal.id, () => ['$ npm test', '', '24 passed', '']);
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      expect(Array.from(cards()[1].querySelectorAll('.preview .line')).map((line) => line.textContent)).toEqual(['$ npm test', '', '24 passed']);
      expect(cards()[0].querySelector('.preview')?.textContent?.trim()).toBe('Sin salida todavía');
    });

    it('stays open after a click inside, for the search, which lands on the Tab that matches', async () => {
      const { key, el, settle, router, switcher, cards, releaseCtrl, ascuaTerminal } = await twoTabs();
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      const field = el.querySelector<HTMLInputElement>('app-switcher input[type=search]')!;
      field.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await releaseCtrl();
      expect(switcher()).not.toBeNull();
      expect(document.activeElement).toBe(field);
      field.value = 'ASC';
      field.dispatchEvent(new Event('input'));
      await settle();
      expect(cards().map((card) => card.querySelector('.names')?.textContent?.trim())).toEqual(['ascua · Terminal 1']);
      await key({ key: 'Enter', code: 'Enter' });
      expect(router.url).toBe(`/projects/p-ascua/terminals/${ascuaTerminal.id}`);
    });

    it('keeps the keys pressed while choosing from the Terminal behind it', async () => {
      const { key } = await twoTabs();
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      const event = await key({ key: 'c', code: 'KeyC', ctrlKey: true });
      expect(event.defaultPrevented).toBe(true);
    });

    it('does not give the keyboard back to the Terminal it leaves', async () => {
      const { key, el, releaseCtrl } = await twoTabs();
      const before = document.createElement('button');
      el.appendChild(before);
      before.focus();
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      const focus = vi.spyOn(before, 'focus');
      await releaseCtrl();
      expect(focus).not.toHaveBeenCalled();
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      await key({ key: 'Escape', code: 'Escape' });
      expect(focus).toHaveBeenCalled();
    });

    it('says when the search matches nothing', async () => {
      const { key, el, settle, cards } = await twoTabs();
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      const field = el.querySelector<HTMLInputElement>('app-switcher input[type=search]')!;
      field.value = 'zzz';
      field.dispatchEvent(new Event('input'));
      await settle();
      expect(cards()).toEqual([]);
      expect(el.querySelector('app-switcher .note')?.textContent?.trim()).toBe('Nada coincide con la búsqueda');
    });

    it('does not open over Settings, nor with no Tab at all', async () => {
      const first = await setup();
      await first.key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      expect(first.el.querySelector('app-switcher')).toBeNull();
      TestBed.resetTestingModule();
      const { key, el, settings, settle } = await twoTabs();
      settings().click();
      await settle();
      await key({ key: 'Tab', code: 'Tab', ctrlKey: true });
      expect(el.querySelector('app-switcher')).toBeNull();
    });
  });
});
