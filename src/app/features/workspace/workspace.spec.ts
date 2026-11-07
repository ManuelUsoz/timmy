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
import { TerminalsState } from './terminals-state';
import { WorkspaceComponent } from './workspace';
import { WorkspaceLayoutState } from './workspace-layout';
import { provideWorkspaceRouter } from './workspace.routes';

const timmy = project('timmy', { lastUsedAt: 2 });
const ascua = project('ascua', { lastUsedAt: 1 });

/** Two projects, timmy used last, so the Workspace opens it and its content column exists. */
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
  const settings = () => sidebar().querySelector<HTMLAnchorElement>('a[href="#/settings"]')!;
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
  return { el, settle, sidebar, settings, key, say, terminalRows, layoutState, stored };
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

  it('goes to Settings from the footer and back to a Project from its row', async () => {
    const { el, sidebar, settings, settle } = await setup();
    settings().click();
    await settle();
    expect(el.querySelector('app-settings-screen')).not.toBeNull();
    expect(settings().getAttribute('aria-current')).toBe('page');
    Array.from(sidebar().querySelectorAll<HTMLElement>('app-project-list as-list-row')).find((r) => r.textContent?.includes('ascua'))!.click();
    await settle();
    expect(el.querySelector('app-projects-screen')).not.toBeNull();
    expect(TestBed.inject(Router).url).toBe('/projects/p-ascua');
  });

  it('opens Settings with Ctrl+,', async () => {
    const { el, key } = await setup();
    const event = await key({ key: ',', ctrlKey: true });
    expect(el.querySelector('app-settings-screen')).not.toBeNull();
    expect(event.defaultPrevented).toBe(true);
  });

  it('opens New project from the sidebar, from Settings too', async () => {
    const { el, sidebar, settings, settle } = await setup();
    settings().click();
    await settle();
    sidebar().querySelector<HTMLButtonElement>('button[aria-label="Nuevo proyecto"]')!.click();
    await settle();
    expect(el.querySelector('app-new-project-dialog')).not.toBeNull();
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
    Array.from(el.querySelectorAll<HTMLButtonElement>('app-settings-screen nav button')).find((b) => b.textContent?.trim() === 'Idioma')!.click();
    await settle();
    const english = Array.from(el.querySelectorAll<HTMLButtonElement>('app-settings-screen [role="radio"]')).find((b) => b.textContent?.trim() === 'English')!;
    english.click();
    await settle();
    expect(settings().textContent).toContain('Settings');
    expect(sidebar().querySelector('.section-label')?.textContent?.trim()).toBe('Projects');
    expect(el.querySelector('app-settings-screen h1')?.textContent).toBe('Settings');
    expect(Effect.runSync(Ref.get(stored))).toBe('en');
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

    it('collapsed, keeps an avatar per Project and Settings, which still navigate', async () => {
      const { el, sidebar, settings, settle } = await setup(1100);
      const tiles = Array.from(sidebar().querySelectorAll<HTMLButtonElement>('app-project-list .rail-project'));
      expect(tiles.map((b) => b.getAttribute('aria-label'))).toEqual(['ascua', 'timmy']);
      expect(tiles.map((b) => b.getAttribute('title'))).toEqual(['ascua · /work/ascua', 'timmy · /work/timmy']);
      tiles[0].click();
      await settle();
      expect(TestBed.inject(Router).url).toBe('/projects/p-ascua');
      settings().click();
      await settle();
      expect(el.querySelector('app-settings-screen')).not.toBeNull();
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

    it('moves the content to an overlay below lg, opened on demand', async () => {
      const { el, settle } = await setup(900);
      expect(el.querySelector('.content')).toBeNull();
      el.querySelector<HTMLButtonElement>('.content-toggle')!.click();
      await settle();
      expect(el.querySelector('.content.overlay')).not.toBeNull();
    });
  });
});
