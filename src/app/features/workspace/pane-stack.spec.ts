import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Effect, Layer, PubSub, Stream } from 'effect';
import type { NotificationEvent, TerminalStatus } from '../../../shared/notification/notification.model';
import { NotificationRpcs } from '../../../shared/notification/notification.rpc';
import { makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { MAX_PANES, addToStack, panesOf, split } from './pane-layout';
import { PaneStack, VIEW_MIME, type DropMark, type ViewDrag } from './pane-stack';
import { layerFakeBackend, layerFakeWorkspace, makeBackend, project } from './projects-fakes';
import { TabsState } from './tabs-state';
import { TerminalId } from './terminal-entries';
import { TerminalsState } from './terminals-state';
import { fileView, terminalView } from './views';

const timmy = project('timmy');

/** The first Tab of the Project, each of its Panes as the grid would lay them out (here simply one after another). */
@Component({
  imports: [PaneStack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (tab(); as tab) {
      @for (pane of panes(); track pane.id) {
        <app-pane-stack [tab]="tab" [pane]="pane" cwd="/work/timmy" [focused]="pane.id === layout()?.focused" [canSplitRight]="true" [canSplitDown]="false" [movable]="movable()" [dropMark]="dropMark()" (dragStarted)="drags.push($event)" (dragEnded)="drags.push('ended')" />
      }
    }
  `,
})
class Host {
  private readonly tabs = inject(TabsState);
  readonly movable = signal(false);
  readonly dropMark = signal<DropMark | undefined>(undefined);
  /** What the Panes told the grid about header drags. */
  readonly drags: Array<ViewDrag | 'ended'> = [];
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
  const backend = makeBackend({ projects: [timmy] });
  const layer = makeDesktopTestLayer(
    Layer.mergeAll(layerFakeBackend(backend), layerFakeWorkspace(backend, ['review']), NotificationRpcs.toLayer({ 'Notification.subscribe': () => Stream.fromPubSub(bus) })),
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
  return { el, backend, host: fixture.componentInstance, tabs, terminals, tab, panes, headers, names, expandedName, button, click, press, hear, stack, settle };
};

describe('A Pane and its Stack', () => {
  it('shows one View with its header: name, status and the Pane controls, and no Stack position', async () => {
    const { headers, button, panes } = await setup();
    const [header] = headers();
    expect(header.classList).toContain('act');
    expect(header.getAttribute('aria-label')).toBe('shell 1');
    expect(header.querySelector('ui-state')?.textContent?.trim()).toBe('Idle');
    expect(header.querySelector('.count')).toBeNull();
    expect(header.querySelector('.grip')).toBeNull();
    expect(button('Dividir a la derecha')?.disabled).toBe(false);
    expect(button('Dividir hacia abajo')?.disabled).toBe(true);
    expect(button('Cerrar panel')).not.toBeNull();
    expect(panes()[0].querySelector('app-terminal-screen header')).toBeNull();
    expect(panes()[0].getAttribute('aria-label')).toBe('Panel de shell 1');
  });

  it('adds up to 3 Views to the Stack, expanding the new one, then disables Add to stack with "3/3"', async () => {
    const { names, expandedName, button, stack, headers } = await setup();
    await stack();
    expect(names()).toEqual(['shell 1', 'shell 2']);
    expect(expandedName()).toBe('shell 2');
    expect(headers()[1].querySelector('.count')?.textContent).toBe('2/2');
    expect(button('Apilar en este panel')?.disabled).toBe(false);
    await stack();
    expect(names()).toEqual(['shell 1', 'shell 2', 'shell 3']);
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
    expect(expandedName()).toBe('shell 1');
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
    expect(expandedName()).toBe('shell 1');
    await press('ArrowDown', { shiftKey: true });
    expect(names()).toEqual(['shell 2', 'shell 1', 'shell 3']);
    await press('ArrowUp', { shiftKey: true });
    expect(names()).toEqual(['shell 1', 'shell 2', 'shell 3']);
    await press('3');
    expect(expandedName()).toBe('shell 3');
    await press('Enter', { shiftKey: true });
    expect(panes()).toHaveLength(2);
    expect(names(panes()[0])).toEqual(['shell 1', 'shell 2']);
    expect(names(panes()[1])).toEqual(['shell 3']);
  });

  it('splits right with Alt+Shift+R and adds to the Stack with Alt+Shift+S, and names the keys in the tooltips', async () => {
    const { panes, names, press, button } = await setup();
    expect(button('Dividir a la derecha')?.getAttribute('title')).toBe('Dividir a la derecha (Alt+Shift+R)');
    expect(button('Dividir hacia abajo')?.getAttribute('title')).toBe('Dividir hacia abajo (Alt+Shift+D)');
    expect(button('Apilar en este panel')?.getAttribute('title')).toBe('Apilar en este panel (Alt+Shift+S)');
    await press('S', { shiftKey: true, code: 'KeyS' });
    expect(names()).toEqual(['shell 1', 'shell 2']);
    await press('R', { shiftKey: true, code: 'KeyR' });
    expect(panes()).toHaveLength(2);
    expect(names(panes()[1])).toEqual(['shell 3']);
  });

  it('leaves Alt+Shift+D to the Terminal when the Pane cannot split down', async () => {
    const { panes } = await setup();
    const event = new KeyboardEvent('keydown', { key: 'D', code: 'KeyD', altKey: true, shiftKey: true, cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(panes()).toHaveLength(1);
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
    expect(names()).toEqual(['shell 2', 'shell 3', 'shell 1']);
  });

  it('lets a lone View\'s header be dragged only when the grid can move it to another Pane', async () => {
    const { host, headers, settle } = await setup();
    expect(headers()[0].getAttribute('draggable')).toBeNull();
    host.movable.set(true);
    await settle();
    expect(headers()[0].getAttribute('draggable')).toBe('true');
  });

  it('tells the grid a header drag started, from which Pane, and ended; the drag carries the View type', async () => {
    const { host, headers, tab, tabs } = await setup();
    host.movable.set(true);
    const data: Record<string, string> = {};
    const start = new Event('dragstart');
    Object.defineProperty(start, 'dataTransfer', { value: { setData: (kind: string, value: string) => (data[kind] = value) } });
    headers()[0].dispatchEvent(start);
    headers()[0].dispatchEvent(new Event('dragend'));
    const view = tabs.layoutOf(tab())!.focused;
    expect(data[VIEW_MIME]).toBe(view);
    expect(host.drags).toEqual([{ view: terminalView(TerminalId.make(view)), fromPane: view }, 'ended']);
  });

  it('shows the drop line where the grid says a View dragged from another Pane would land', async () => {
    const { host, headers, stack, settle } = await setup();
    await stack();
    host.dropMark.set({ index: 0, side: 'before' });
    await settle();
    expect(headers()[0].previousElementSibling?.classList).toContain('drop');
    host.dropMark.set(undefined);
    await settle();
    expect(headers()[0].previousElementSibling).toBeNull();
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
      ['Mostrar shell 1', 'Alt 1', false],
      ['Mover un lugar arriba', 'Alt Shift ↑', false],
      ['Mover un lugar abajo', 'Alt Shift ↓', true],
      ['Desapilar en un panel nuevo', 'Alt Shift ⏎', false],
      ['Renombrar terminal', '', false],
      ['Reiniciar', '', true],
      ['Abrir diff · Pronto', '', true],
      ['Abrir PR · Pronto', '', true],
      ['Cerrar shell 2', '', false],
      ['Cerrar panel', '', false],
    ]);
  });

  it('closes an Idle View at once, and asks first for a Working one', async () => {
    const { el, panes, names, button, click, stack, hear, terminals } = await setup();
    await stack();
    await click(button('Más acciones'));
    await click(Array.from(panes()[0].querySelectorAll<HTMLButtonElement>('[role=menuitem]')).find((item) => item.textContent?.includes('Cerrar shell 2')));
    expect(el.querySelector('ui-modal')).toBeNull();
    expect(names()).toEqual(['shell 1']);

    await hear(terminals.entries()[0].id, 'Working');
    await click(button('Cerrar panel'));
    const modal = el.querySelector('ui-modal')!;
    expect(modal.querySelector('h2')?.textContent).toBe('¿Cerrar el panel?');
    await click(modal.querySelector<HTMLButtonElement>('.primary'));
    expect(panes()).toHaveLength(0);
    expect(terminals.entries()).toEqual([]);
  });
});

describe('A Terminal named in its header', () => {
  /** Types `value` in the open name field and presses `key` in it. */
  const typeIn = async (el: HTMLElement, value: string, key: 'Enter' | 'Escape', settle: () => Promise<void>) => {
    const field = el.querySelector<HTMLInputElement>('app-terminal-name-field input')!;
    field.value = value;
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    await settle();
  };

  it('shows the name and its #n, in the expanded header and the collapsed ones', async () => {
    const { headers, stack } = await setup();
    await stack();
    expect(headers().map((header) => [header.querySelector('.name')?.textContent, header.querySelector('.number')?.textContent])).toEqual([
      ['shell 1', '#1'],
      ['shell 2', '#2'],
    ]);
  });

  it('renames the Terminal with a double click on its name, keeping its #n', async () => {
    const { el, headers, backend, terminals, settle } = await setup();
    headers()[0].querySelector('.name')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    const field = el.querySelector<HTMLInputElement>('app-terminal-name-field input')!;
    expect(field.value).toBe('shell 1');
    expect(document.activeElement).toBe(field);
    await typeIn(el, '  build ', 'Enter', settle);
    expect(el.querySelector('app-terminal-name-field')).toBeNull();
    expect(headers()[0].getAttribute('aria-label')).toBe('build');
    expect(headers()[0].querySelector('.number')?.textContent).toBe('#1');
    expect(terminals.entries()[0].name).toBe('build');
    expect(backend.calls).toContain('Workspace.renameTerminal:build');
  });

  it('refuses inline a name another Terminal of the Project has, in any case, and Escape keeps the old name', async () => {
    const { el, headers, stack, click, button, backend, settle } = await setup();
    await stack();
    await click(button('Más acciones'));
    await click(Array.from(el.querySelectorAll<HTMLButtonElement>('[role=menuitem]')).find((item) => item.textContent?.includes('Renombrar terminal')));
    await typeIn(el, 'SHELL 1', 'Enter', settle);
    expect(el.querySelector('app-terminal-name-field [role=alert]')?.textContent).toBe('Ya hay una terminal llamada «SHELL 1» en este proyecto.');
    expect(el.querySelector('app-terminal-name-field input')?.getAttribute('aria-invalid')).toBe('true');
    expect(backend.calls.filter((call) => call.startsWith('Workspace.renameTerminal'))).toEqual([]);
    await typeIn(el, 'SHELL 1', 'Escape', settle);
    expect(el.querySelector('app-terminal-name-field')).toBeNull();
    expect(headers().map((header) => header.getAttribute('aria-label'))).toEqual(['shell 1', 'shell 2']);
  });

  it('does on leaving the field what Enter does: a taken name is refused there, not dropped', async () => {
    const { el, headers, stack, terminals, settle } = await setup();
    await stack();
    headers()[1].querySelector('.name')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    const field = el.querySelector<HTMLInputElement>('app-terminal-name-field input')!;
    field.value = 'Shell 1';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(el.querySelector('app-terminal-name-field [role=alert]')?.textContent).toBe('Ya hay una terminal llamada «Shell 1» en este proyecto.');
    field.value = 'tests';
    field.dispatchEvent(new Event('input'));
    field.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(el.querySelector('app-terminal-name-field')).toBeNull();
    expect(terminals.entries().map((entry) => entry.name)).toEqual(['shell 1', 'tests']);
  });

  it('shows inline a refusal from main, which knows the Terminals saved', async () => {
    const { el, headers, settle } = await setup();
    headers()[0].querySelector('.name')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    await typeIn(el, 'review', 'Enter', settle);
    expect(el.querySelector('app-terminal-name-field [role=alert]')?.textContent).toBe('Ya hay una terminal llamada «review» en este proyecto.');
    expect(headers()[0].querySelector('.name')).toBeNull();
  });
});

describe('A File View in a Pane', () => {
  /** The Tab with its Terminal and a preview File View of README.md beside it, as a click in the tree opens it. */
  const withFile = async () => {
    const context = await setup();
    context.backend.files.disks['/work/timmy'] = { dirs: { '': [] }, files: { 'README.md': { kind: 'text', content: '# timmy\n' } }, index: [] };
    context.terminals.setCurrent(context.tab().terminals[0].id);
    context.tabs.openFile(context.tab(), 'README.md');
    await context.settle();
    const files = () => context.tabs.filesOf(context.tab()).map((open) => `${open.path}${open.pinned ? ' (pinned)' : ''}`);
    return { ...context, files };
  };

  it('has a header of its own: the file name, a preview mark, a pin button and the Pane controls, and the text below', async () => {
    const { panes, headers } = await withFile();
    expect(panes()).toHaveLength(2);
    const [header] = headers(panes()[1]);
    expect(header.getAttribute('aria-label')).toBe('README.md');
    expect(header.querySelector('.tag')?.textContent?.trim()).toBe('Vista previa');
    expect(header.querySelector('.pin')?.getAttribute('aria-pressed')).toBe('false');
    expect(header.querySelector('ui-state')).toBeNull();
    expect(header.querySelector('.number')).toBeNull();
    expect(panes()[1].querySelector('app-file-view .source')?.textContent).toBe('# timmy\n');
    expect(panes()[1].querySelector('app-terminal-screen')).toBeNull();
  });

  it('is pinned by dragging its header, which also tells the grid it moves', async () => {
    const { host, panes, headers, files, settle } = await withFile();
    host.movable.set(true);
    await settle();
    headers(panes()[1])[0].dispatchEvent(new Event('dragstart'));
    await settle();
    expect(files()).toEqual(['README.md (pinned)']);
    expect(host.drags).toEqual([{ view: fileView('README.md'), fromPane: 'file:README.md' }]);
  });

  it('stacks with a Terminal and unstacks into a Pane of its own, like a Terminal', async () => {
    const { tabs, tab, panes, names, click, button, settle } = await withFile();
    tabs.update(tab(), (layout) => addToStack(layout, panesOf(layout)[0].id, fileView('README.md')));
    await settle();
    expect(panes()).toHaveLength(1);
    expect(names()).toEqual(['shell 1', 'README.md']);
    await click(button('Más acciones'));
    const items = Array.from(panes()[0].querySelectorAll<HTMLButtonElement>('[role=menu] [role=menuitem]')).map((item) => item.querySelector('.mi-label')?.textContent?.trim());
    // A file has no name to change, nothing to restart, no diff or PR of its own here.
    expect(items).toEqual(['Mostrar shell 1', 'Mover un lugar arriba', 'Mover un lugar abajo', 'Desapilar en un panel nuevo', 'Cerrar README.md', 'Cerrar panel']);
    await click(Array.from(panes()[0].querySelectorAll<HTMLButtonElement>('[role=menuitem]')).find((item) => item.textContent?.includes('Desapilar')));
    expect(panes()).toHaveLength(2);
    expect(names(panes()[1])).toEqual(['README.md']);
  });

  it('closes on its own from a Stack, at once and without asking, the Terminal staying', async () => {
    const { el, tabs, tab, panes, names, click, button, files, hear, settle } = await withFile();
    tabs.update(tab(), (layout) => addToStack(layout, panesOf(layout)[0].id, fileView('README.md')));
    await hear(tab().terminals[0].id, 'Working');
    await settle();
    await click(button('Más acciones'));
    await click(Array.from(panes()[0].querySelectorAll<HTMLButtonElement>('[role=menuitem]')).find((item) => item.textContent?.includes('Cerrar README.md')));
    expect(el.querySelector('ui-modal')).toBeNull();
    expect(files()).toEqual([]);
    expect(names()).toEqual(['shell 1']);
  });

  it('closes the Tab with its File Views when the last Terminal closes, a pinned one in another Pane included', async () => {
    const { tabs, tab, panes, click, button, settle } = await withFile();
    tabs.pinFile(tab(), 'README.md');
    await settle();
    await click(button('Cerrar panel', panes()[0]));
    expect(tabs.tabsOf(timmy.projectId)).toEqual([]);
    expect(panes()).toHaveLength(0);
  });
});
