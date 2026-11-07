import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Effect, Layer, PubSub, Stream } from 'effect';
import type { NotificationEvent, TerminalStatus } from '../../../shared/notification/notification.model';
import { NotificationRpcs } from '../../../shared/notification/notification.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { MAX_PANES, panesOf, split } from './pane-layout';
import { PaneStack } from './pane-stack';
import { layerFakeBackend, makeBackend, project } from './projects-fakes';
import { TabsState } from './tabs-state';
import type { TerminalId } from './terminal-entries';
import { TerminalsState } from './terminals-state';

const timmy = project('timmy');

/** The first Tab of the Project, each of its Panes as the grid would lay them out (here simply one after another). */
@Component({
  imports: [PaneStack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tab(); as tab) {
      @for (pane of panes(); track pane.id) {
        <app-pane-stack [tab]="tab" [pane]="pane" cwd="/work/timmy" [focused]="pane.id === layout()?.focused" [canSplitRight]="true" [canSplitDown]="false" />
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

const setup = async () => {
  const bus = Effect.runSync(PubSub.unbounded<NotificationEvent>());
  const layer = makeDesktopTestLayer(
    Layer.mergeAll(layerFakeBackend(makeBackend({ projects: [timmy] })), NotificationRpcs.toLayer({ 'Notification.subscribe': () => Stream.fromPubSub(bus) })),
  );
  await TestBed.configureTestingModule({
    imports: [Host],
    providers: [{ provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } }],
  }).compileComponents();
  const terminals = TestBed.inject(TerminalsState);
  const tabs = TestBed.inject(TabsState);
  // The Tab starts with one Terminal, as New Tab makes it.
  terminals.create(timmy.projectId);
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
  const panes = () => Array.from(el.querySelectorAll<HTMLElement>('app-pane-stack'));
  const headers = (pane = panes()[0]) => Array.from(pane.querySelectorAll<HTMLElement>('.view-header'));
  const names = (pane = panes()[0]) => headers(pane).map((header) => header.getAttribute('aria-label'));
  const expandedName = (pane = panes()[0]) => pane.querySelector('.view-header.act')?.getAttribute('aria-label');
  const button = (label: string, pane = panes()[0]) => pane.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  const click = async (element: HTMLElement | null | undefined) => {
    if (element == null) throw new Error('nothing to click');
    element.click();
    await settle();
  };
  const press = async (key: string, modifiers: { shiftKey?: boolean; code?: string } = {}) => {
    const code = modifiers.code ?? (/^[0-9]$/.test(key) ? `Digit${key}` : key);
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code, altKey: true, shiftKey: modifiers.shiftKey ?? false, cancelable: true }));
    await settle();
  };
  const hear = async (terminalId: TerminalId, type: TerminalStatus) => {
    await Effect.runPromise(PubSub.publish(bus, { _tag: 'Notified', notification: { source: { _tag: 'Terminal', terminalId }, type, seen: false, onScreen: false } }));
    await settle();
  };
  /** "Add to stack" with no Provider enabled opens a shell at once. */
  const stack = async () => click(button('Apilar en este panel'));
  return { el, tabs, terminals, tab, panes, headers, names, expandedName, button, click, press, hear, stack, settle };
};

describe('A Pane and its Stack', () => {
  it('shows one View with its header: name, status and the Pane controls, and no Stack position', async () => {
    const { headers, button, panes } = await setup();
    const [header] = headers();
    expect(header.classList).toContain('act');
    expect(header.getAttribute('aria-label')).toBe('Terminal 1');
    expect(header.querySelector('ui-state')?.textContent?.trim()).toBe('Idle');
    expect(header.querySelector('.count')).toBeNull();
    expect(header.querySelector('.grip')).toBeNull();
    expect(button('Dividir a la derecha')?.disabled).toBe(false);
    expect(button('Dividir hacia abajo')?.disabled).toBe(true);
    expect(button('Cerrar panel')).not.toBeNull();
    expect(panes()[0].querySelector('app-terminal-screen header')).toBeNull();
    expect(panes()[0].getAttribute('aria-label')).toBe('Panel de Terminal 1');
  });

  it('adds up to 3 Views to the Stack, expanding the new one, then disables Add to stack with "3/3"', async () => {
    const { names, expandedName, button, stack, headers } = await setup();
    await stack();
    expect(names()).toEqual(['Terminal 1', 'Terminal 2']);
    expect(expandedName()).toBe('Terminal 2');
    expect(headers()[1].querySelector('.count')?.textContent).toBe('2/2');
    expect(button('Apilar en este panel')?.disabled).toBe(false);
    await stack();
    expect(names()).toEqual(['Terminal 1', 'Terminal 2', 'Terminal 3']);
    const add = button('Apilar en este panel')!;
    expect(add.disabled).toBe(true);
    expect(add.getAttribute('title')).toBe('Apilar en este panel · 3/3');
  });

  it('collapses the other Views to headers with only icon, name and status, and expands one on click', async () => {
    const { headers, expandedName, stack, click, panes } = await setup();
    await stack();
    const collapsed = headers()[0];
    expect(collapsed.classList).toContain('collapsed');
    expect(collapsed.querySelector('.glyph')).not.toBeNull();
    expect(collapsed.querySelector('ui-state')?.textContent?.trim()).toBe('Idle');
    expect(collapsed.querySelector('.ctl')).toBeNull();
    expect(panes()[0].querySelectorAll('app-terminal-screen')).toHaveLength(1);
    await click(collapsed);
    expect(expandedName()).toBe('Terminal 1');
  });

  it('splits right into a new, focused Pane', async () => {
    const { panes, button, click, tabs, tab } = await setup();
    await click(button('Dividir a la derecha'));
    expect(panes()).toHaveLength(2);
    expect(panes().map((pane) => pane.classList.contains('focused'))).toEqual([false, true]);
    expect(tabs.layoutOf(tab())?.root).toMatchObject({ kind: 'split', direction: 'right' });
  });

  it('leaves the Stack keys to the Terminal when they would do nothing (a Pane that is not a Stack)', async () => {
    await setup();
    const keys = [
      { key: '1', code: 'Digit1', shiftKey: false },
      { key: 'ArrowUp', code: 'ArrowUp', shiftKey: true },
      { key: 'Enter', code: 'Enter', shiftKey: true },
    ];
    for (const { key, code, shiftKey } of keys) {
      const event = new KeyboardEvent('keydown', { key, code, altKey: true, shiftKey, cancelable: true });
      window.dispatchEvent(event);
      expect(event.defaultPrevented, key).toBe(false);
    }
  });

  it('answers Alt+1–3, Alt+Shift+↑/↓ and Alt+Shift+Enter in the focused Pane', async () => {
    const { names, expandedName, stack, press, panes } = await setup();
    await stack();
    await stack();
    await press('1');
    expect(expandedName()).toBe('Terminal 1');
    await press('ArrowDown', { shiftKey: true });
    expect(names()).toEqual(['Terminal 2', 'Terminal 1', 'Terminal 3']);
    await press('ArrowUp', { shiftKey: true });
    expect(names()).toEqual(['Terminal 1', 'Terminal 2', 'Terminal 3']);
    await press('3');
    expect(expandedName()).toBe('Terminal 3');
    await press('Enter', { shiftKey: true });
    expect(panes()).toHaveLength(2);
    expect(names(panes()[0])).toEqual(['Terminal 1', 'Terminal 2']);
    expect(names(panes()[1])).toEqual(['Terminal 3']);
  });

  it('does not unstack at 6 Panes', async () => {
    const { tabs, tab, stack, press, panes, settle } = await setup();
    await stack();
    for (let n = 0; n < MAX_PANES - 1; n++) {
      await tabs.openInTab(tab(), '/work/timmy', undefined, (layout, terminal) => split(layout, layout.focused, 'right', terminal));
    }
    // Back to the first Pane, which has the Stack.
    tabs.update(tab(), (layout) => ({ ...layout, focused: panesOf(layout)[0].id }));
    await settle();
    expect(panes()).toHaveLength(MAX_PANES);
    await press('Enter', { shiftKey: true });
    expect(panes()).toHaveLength(MAX_PANES);
  });

  it('reorders the Stack by dragging a header onto another', async () => {
    const { names, headers, stack, settle } = await setup();
    await stack();
    await stack();
    const [first, , third] = headers();
    first.dispatchEvent(new Event('dragstart'));
    third.dispatchEvent(new Event('dragover', { cancelable: true }));
    await settle();
    // The expanded View moves down past the last one: the line is below it, after its body.
    expect(third.nextElementSibling?.nextElementSibling?.classList).toContain('drop');
    third.dispatchEvent(new Event('drop', { cancelable: true }));
    await settle();
    expect(names()).toEqual(['Terminal 2', 'Terminal 3', 'Terminal 1']);
  });

  it('lists the actions in the header menu with their keys, and Open diff and Open PR disabled "· Soon"', async () => {
    const { panes, button, click, stack } = await setup();
    await stack();
    await click(button('Más acciones'));
    const items = Array.from(panes()[0].querySelectorAll<HTMLButtonElement>('[role=menu] [role=menuitem]')).map((item) => [
      item.querySelector('.mi-label')?.textContent?.trim(),
      Array.from(item.querySelectorAll('kbd')).map((key) => key.textContent).join(' '),
      item.disabled,
    ]);
    expect(items).toEqual([
      ['Mostrar Terminal 1', 'Alt 1', false],
      ['Mover un lugar arriba', 'Alt Shift ↑', false],
      ['Mover un lugar abajo', 'Alt Shift ↓', true],
      ['Desapilar en un panel nuevo', 'Alt Shift ⏎', false],
      ['Reiniciar', '', true],
      ['Abrir diff · Pronto', '', true],
      ['Abrir PR · Pronto', '', true],
      ['Cerrar Terminal 2', '', false],
      ['Cerrar panel', '', false],
    ]);
  });

  it('closes an Idle View at once, and asks first for a Working one', async () => {
    const { el, panes, names, button, click, stack, hear, terminals } = await setup();
    await stack();
    await click(button('Más acciones'));
    await click(Array.from(panes()[0].querySelectorAll<HTMLButtonElement>('[role=menuitem]')).find((item) => item.textContent?.includes('Cerrar Terminal 2')));
    expect(el.querySelector('ui-modal')).toBeNull();
    expect(names()).toEqual(['Terminal 1']);

    await hear(terminals.entries()[0].id, 'Working');
    await click(button('Cerrar panel'));
    const modal = el.querySelector('ui-modal')!;
    expect(modal.querySelector('h2')?.textContent).toBe('¿Cerrar el panel?');
    await click(modal.querySelector<HTMLButtonElement>('.primary'));
    expect(panes()).toHaveLength(0);
    expect(terminals.entries()).toEqual([]);
  });
});
