import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Effect, Layer, PubSub, Stream } from 'effect';
import type { NotificationEvent, TerminalStatus } from '../../../shared/notification/notification.model';
import { NotificationRpcs } from '../../../shared/notification/notification.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { layerFakeBackend, makeBackend, project } from './projects-fakes';
import type { TerminalId } from './terminal-entries';
import { TerminalsState } from './terminals-state';
import { WorkspaceComponent } from './workspace';
import { WorkspaceLayoutState } from './workspace-layout';
import { provideWorkspaceRouter } from './workspace.routes';

const timmy = project('timmy');
const ascua = project('ascua');

/** The Workspace on the fake backend, with main's Notification bus as a PubSub the test speaks through. */
const setup = async () => {
  const bus = Effect.runSync(PubSub.unbounded<NotificationEvent>());
  const layer = makeDesktopTestLayer(
    Layer.mergeAll(layerFakeBackend(makeBackend({ projects: [timmy, ascua] })), NotificationRpcs.toLayer({ 'Notification.subscribe': () => Stream.fromPubSub(bus) })),
  );
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
  const router = TestBed.inject(Router);
  const terminals = TestBed.inject(TerminalsState);
  const settle = async () => {
    for (let i = 0; i < 3; i++) {
      await fixture.whenStable();
      await new Promise((r) => setTimeout(r));
      fixture.detectChanges();
    }
  };
  fixture.detectChanges();
  await settle();
  await router.navigate(['/projects', timmy.projectId]);
  await settle();

  const bar = () => el.querySelector<HTMLElement>('app-tab-bar nav');
  const tabNames = () => Array.from(el.querySelectorAll('app-tab-bar .tab-button .name')).map((name) => name.textContent);
  const tabButton = (n: number) => el.querySelectorAll<HTMLButtonElement>('app-tab-bar .tab-button')[n];
  const activeTab = () => el.querySelector('app-tab-bar .tab-button[aria-current=page] .name')?.textContent;
  const press = async (key: string) => {
    const code = /^[0-9]$/.test(key) ? `Digit${key}` : `Key${key.toUpperCase()}`;
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code, ctrlKey: true, cancelable: true }));
    await settle();
  };
  const click = async (element: HTMLElement | null | undefined) => {
    if (element == null) throw new Error('nothing to click');
    element.click();
    await settle();
  };
  /** A Terminal entering a status, as main's bus says it. */
  const hear = async (terminalId: TerminalId, type: TerminalStatus) => {
    await Effect.runPromise(PubSub.publish(bus, { _tag: 'Notified', notification: { source: { _tag: 'Terminal', terminalId }, type, seen: false, onScreen: false } }));
    await settle();
  };
  const terminalOfTab = (n: number) => terminals.entries().filter((entry) => entry.projectId === timmy.projectId)[n].id;
  const closeButton = (name: string) => el.querySelector<HTMLButtonElement>(`app-tab-bar button[aria-label="Cerrar pestaña ${name}"]`);
  return { el, router, settle, bar, tabNames, tabButton, activeTab, press, click, hear, terminalOfTab, closeButton };
};

describe('Tabs of a Project', () => {
  it('shows only the New Tab action, with its key hint, while the Project has no Tabs', async () => {
    const { el, bar } = await setup();
    expect(bar()).toBeNull();
    const stage = el.querySelector('app-projects-screen .stage')!;
    expect(stage.querySelector('app-workspace-hero')).toBeNull();
    const buttons = Array.from(stage.querySelectorAll('button'));
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Nueva pestaña']);
    expect(Array.from(buttons[0].querySelectorAll('kbd')).map((key) => key.textContent)).toEqual(['Ctrl', 'T']);
  });

  it('opens a Tab named after its Terminal from the New Tab action, and another with "+"', async () => {
    const { el, router, bar, tabNames, activeTab, click } = await setup();
    await click(el.querySelector<HTMLButtonElement>('.no-tabs button'));
    expect(bar()?.getAttribute('aria-label')).toBe('Pestañas de timmy');
    expect(tabNames()).toEqual(['Terminal 1']);
    expect(router.url).toMatch(/^\/projects\/p-timmy\/terminals\/.+/);
    await click(el.querySelector<HTMLButtonElement>('app-tab-bar button[aria-label="Nueva pestaña"]'));
    expect(tabNames()).toEqual(['Terminal 1', 'Terminal 2']);
    expect(activeTab()).toBe('Terminal 2');
    expect(Array.from(el.querySelectorAll('app-tab-bar .ix')).map((ix) => ix.textContent)).toEqual(['1', '2']);
  });

  it('opens a Tab with Ctrl+T and goes to a Tab with Ctrl+number', async () => {
    const { tabNames, activeTab, press, el } = await setup();
    await press('t');
    await press('t');
    expect(tabNames()).toEqual(['Terminal 1', 'Terminal 2']);
    await press('1');
    expect(activeTab()).toBe('Terminal 1');
    expect(el.querySelector('app-terminal-screen h1')?.textContent).toBe('Terminal 1');
    await press('2');
    expect(activeTab()).toBe('Terminal 2');
    await press('5');
    expect(activeTab()).toBe('Terminal 2');
  });

  it('ignores Ctrl+T and Ctrl+number while Settings covers the screen', async () => {
    const { tabNames, activeTab, press } = await setup();
    await press('t');
    await press('t');
    await press(',');
    await press('t');
    await press('1');
    await press(',');
    expect(tabNames()).toEqual(['Terminal 1', 'Terminal 2']);
    expect(activeTab()).toBe('Terminal 2');
  });

  it('closes the Tab on screen for the one after it, or the one before when it was the last', async () => {
    const { tabNames, activeTab, press, click, closeButton } = await setup();
    await press('t');
    await press('t');
    await press('t');
    await press('2');
    await click(closeButton('Terminal 2'));
    expect(tabNames()).toEqual(['Terminal 1', 'Terminal 3']);
    expect(activeTab()).toBe('Terminal 3');
    await click(closeButton('Terminal 3'));
    expect(activeTab()).toBe('Terminal 1');
  });

  it('goes to a Tab with a click', async () => {
    const { tabButton, activeTab, press, click } = await setup();
    await press('t');
    await press('t');
    await click(tabButton(0));
    expect(activeTab()).toBe('Terminal 1');
  });

  it('renames a Tab with a double click; Escape keeps the name, and a blank name gives back the Terminal\'s', async () => {
    const { el, tabButton, tabNames, press, settle } = await setup();
    await press('t');
    const rename = async (value: string, key: 'Enter' | 'Escape') => {
      tabButton(0).dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle();
      const field = el.querySelector<HTMLInputElement>('app-tab-bar input[aria-label="Nombre de la pestaña"]')!;
      expect(document.activeElement).toBe(field);
      field.value = value;
      field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await settle();
    };
    await rename('review', 'Enter');
    expect(tabNames()).toEqual(['review']);
    await rename('other', 'Escape');
    expect(tabNames()).toEqual(['review']);
    await rename('  ', 'Enter');
    expect(tabNames()).toEqual(['Terminal 1']);
  });

  it('shows a dot only while a Terminal of the Tab is Waiting or Error', async () => {
    const { el, press, hear, terminalOfTab } = await setup();
    await press('t');
    const dot = () => el.querySelector('app-tab-bar .dot')?.getAttribute('aria-label') ?? null;
    expect(dot()).toBeNull();
    await hear(terminalOfTab(0), 'Working');
    expect(dot()).toBeNull();
    await hear(terminalOfTab(0), 'Waiting');
    expect(dot()).toBe('Waiting');
    await hear(terminalOfTab(0), 'Error');
    expect(dot()).toBe('Error');
    await hear(terminalOfTab(0), 'Done');
    expect(dot()).toBeNull();
  });

  it('closes a Tab and its Terminals at once while none is Working or Waiting, showing the next Tab', async () => {
    const { el, tabNames, activeTab, press, click, hear, terminalOfTab, closeButton } = await setup();
    await press('t');
    await press('t');
    await hear(terminalOfTab(1), 'Done');
    await click(closeButton('Terminal 2'));
    expect(el.querySelector('ui-modal')).toBeNull();
    expect(tabNames()).toEqual(['Terminal 1']);
    expect(activeTab()).toBe('Terminal 1');
    expect(TestBed.inject(TerminalsState).entries().map((entry) => entry.number)).toEqual([1]);
  });

  it('asks before closing a Tab whose Terminal is Working, and keeps it when the user cancels', async () => {
    const { el, tabNames, press, click, hear, terminalOfTab, closeButton, bar } = await setup();
    await press('t');
    await hear(terminalOfTab(0), 'Working');
    await click(closeButton('Terminal 1'));
    const modal = el.querySelector('ui-modal')!;
    expect(modal.querySelector('h2')?.textContent).toBe('¿Cerrar la pestaña Terminal 1?');
    await click(modal.querySelector<HTMLButtonElement>('.dismiss'));
    expect(tabNames()).toEqual(['Terminal 1']);

    await hear(terminalOfTab(0), 'Waiting');
    await click(closeButton('Terminal 1'));
    await click(el.querySelector<HTMLButtonElement>('ui-modal .primary'));
    expect(bar()).toBeNull();
    expect(el.querySelector('.no-tabs button')).not.toBeNull();
  });

  it('keeps each Project\'s Tabs apart', async () => {
    const { router, settle, press, tabNames, bar } = await setup();
    await press('t');
    await router.navigate(['/projects', ascua.projectId]);
    await settle();
    expect(bar()).toBeNull();
    await press('t');
    expect(tabNames()).toEqual(['Terminal 1']);
    await press('1');
    expect(router.url).toMatch(/^\/projects\/p-ascua\//);
  });

  it('shows Files, Agents, Changes, PRs and Usage as disabled icons that say "Soon"', async () => {
    const { el, press, settle } = await setup();
    await press('t');
    const tools = Array.from(el.querySelectorAll<HTMLButtonElement>('app-tab-bar .tools button'));
    expect(tools.map((tool) => [tool.getAttribute('aria-label'), tool.getAttribute('aria-disabled'), tool.textContent?.trim()])).toEqual([
      ['Archivos', 'true', ''],
      ['Agentes', 'true', ''],
      ['Cambios', 'true', ''],
      ['PRs', 'true', ''],
      ['Consumo', 'true', ''],
    ]);
    tools[1].dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    await settle();
    expect(el.querySelector('app-tab-bar [role=tooltip]')?.textContent).toBe('Agentes · Pronto');
  });
});
