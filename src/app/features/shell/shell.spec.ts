import { TestBed } from '@angular/core/testing';
import { Effect, Layer, PubSub, Ref, Stream } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import type { NotificationEvent, TerminalStatus } from '../../../shared/notification/notification.model';
import { NotificationRpcs } from '../../../shared/notification/notification.rpc';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import { WindowRpcs } from '../../../shared/window/window.rpc';
import type { WindowMode } from '../../../shared/window/window.model';
import { layerFilesUnused, layerProjectsUnused, makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ProjectId } from '../../../shared/projects/projects.model';
import { provideWorkspaceRouter } from '../workspace/workspace.routes';
import { TerminalsState } from '../workspace/terminals-state';
import { ShellComponent } from './shell';

/** Real client against fake handlers: the window is just a Ref, like main's service behind its host. */
const setup = async () => {
  const closes: number[] = [];
  const minimizes: number[] = [];
  const toggles: number[] = [];
  const maximized = Ref.makeUnsafe(false);
  const maximizedChanges = Effect.runSync(PubSub.unbounded<boolean>());
  /** What main does when its window is maximized or restored, by the user or by the system. */
  const setMaximized = (value: boolean) =>
    Effect.runPromise(Ref.set(maximized, value).pipe(Effect.andThen(PubSub.publish(maximizedChanges, value)), Effect.asVoid));
  const mode = Ref.makeUnsafe<WindowMode>('Pill');
  const notifications = Effect.runSync(PubSub.unbounded<NotificationEvent>());
  /** What main's bus says: a Terminal entering a status, or going away. */
  const hear = (event: NotificationEvent) => Effect.runPromise(PubSub.publish(notifications, event).pipe(Effect.asVoid));
  const handlers = Layer.mergeAll(
    AppInfoRpcs.toLayer({
      'AppInfo.get': () =>
        Effect.succeed({ name: 't', version: '1', electron: '1', chrome: '1', node: '1', platform: 'win32', cwd: '/work' }),
    }),
    WindowRpcs.toLayer({
      'Window.current': () => Ref.get(mode),
      'Window.request': ({ mode: target }) => Ref.set(mode, target).pipe(Effect.as(target)),
      'Window.close': () => Effect.sync(() => void closes.push(1)),
      'Window.minimize': () => Effect.sync(() => void minimizes.push(1)),
      'Window.toggleMaximize': () =>
        Effect.sync(() => void toggles.push(1)).pipe(
          Effect.andThen(Ref.get(maximized)),
          Effect.flatMap((current) => Effect.promise(() => setMaximized(!current))),
          Effect.asVoid,
        ),
      'Window.maximized': () =>
        Stream.concat(Stream.fromEffect(Ref.get(maximized)), Stream.fromPubSub(maximizedChanges)),
    }),
    NotificationRpcs.toLayer({ 'Notification.subscribe': () => Stream.fromPubSub(notifications) }),
    layerFilesUnused,
    layerProjectsUnused,
    SettingsRpcs.toLayer({
      'Settings.get': () => Effect.succeed({ language: 'es' as const, providers: [] }),
      'Settings.setLanguage': ({ language }) => Effect.succeed({ language, providers: [] }),
      'Settings.setProvider': ({ enabled, provider }) => Effect.succeed({ language: 'es' as const, providers: enabled ? [provider] : [] }),
    }),
  );
  const layer = makeDesktopTestLayer(handlers);
  await TestBed.configureTestingModule({
    imports: [ShellComponent],
    providers: [provideWorkspaceRouter(), { provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } }],
  }).compileComponents();
  const fixture = TestBed.createComponent(ShellComponent);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  fixture.detectChanges();
  await settle();
  return { el, settle, fixture, closes, minimizes, toggles, setMaximized, hear };
};

describe('ShellComponent', () => {
  it('starts as the Pill, Idle, with real buttons for the pill and the switcher', async () => {
    const { el } = await setup();
    expect(el.querySelector('app-panel-terminal')).toBeNull();
    expect(el.querySelector('ui-pill button')?.textContent).toContain('Idle');
    expect(el.querySelector('button[aria-label="Change window mode"]')).not.toBeNull();
  });

  it('opens the Panel on double-click of the Pill', async () => {
    const { el, settle } = await setup();
    el.querySelector('ui-pill')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(el.querySelector('app-panel-terminal')).not.toBeNull();
  });

  it('opens the Panel from the switcher button in the Pill', async () => {
    const { el, settle } = await setup();
    (el.querySelector('button[aria-label="Change window mode"]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('app-panel-terminal')).not.toBeNull();
    expect(el.querySelector('ui-option')).toBeNull();
  });

  it.each(['Pill', 'Panel'])('quits from the Close button in %s without changing the mode', async (from) => {
    const { el, settle, closes } = await setup();
    if (from === 'Panel') {
      el.querySelector('ui-pill')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      await settle();
    }
    const close = el.querySelector<HTMLButtonElement>('button[aria-label="Close Timmy"]')!;
    close.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    close.click();
    await settle();
    expect(closes).toHaveLength(1);
    expect((el.querySelector('app-panel-terminal') !== null)).toBe(from === 'Panel');
  });

  it('returns to the Pill on double-click of the Panel header, and ignores Escape', async () => {
    const { el, settle } = await setup();
    el.querySelector('ui-pill')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(el.querySelector('app-panel-terminal')).not.toBeNull();
    el.querySelector('.panel-header')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(el.querySelector('app-panel-terminal')).toBeNull();
  });

  const SWITCHER = '.panel-header button[aria-label="Change window mode"]';
  const openSwitcher = async (ctx: Awaited<ReturnType<typeof setup>>) => {
    ctx.el.querySelector<HTMLButtonElement>(SWITCHER)!.click();
    await ctx.settle();
    return Array.from(ctx.el.querySelectorAll('ui-option')).map((o) => o.textContent?.trim());
  };
  const openExpandedSwitcher = async (ctx: Awaited<ReturnType<typeof setup>>) => {
    ctx.el.querySelector<HTMLButtonElement>('.titlebar button[aria-label="Change window mode"]')!.click();
    await ctx.settle();
    return Array.from(ctx.el.querySelectorAll('ui-option')).map((o) => o.textContent?.trim());
  };
  const choose = async (ctx: Awaited<ReturnType<typeof setup>>, label: string) => {
    const option = Array.from(ctx.el.querySelectorAll('ui-option')).find((o) => o.textContent?.trim() === label);
    (option as HTMLElement).click();
    await ctx.settle();
  };
  const openPanel = async (ctx: Awaited<ReturnType<typeof setup>>) => {
    ctx.el.querySelector<HTMLButtonElement>('button[aria-label="Change window mode"]')!.click();
    await ctx.settle();
  };

  it('offers the other two modes from the Panel and Expanded', async () => {
    const ctx = await setup();
    await openPanel(ctx);
    expect(await openSwitcher(ctx)).toEqual(['Pill', 'Expanded']);
    await choose(ctx, 'Expanded');
    expect(ctx.el.querySelector('app-workspace')).not.toBeNull();
    expect(ctx.el.querySelector('app-panel-terminal')).toBeNull();
    expect(await openExpandedSwitcher(ctx)).toEqual(['Pill', 'Panel']);
  });

  describe('Expanded window controls', () => {
    const toExpanded = async () => {
      const ctx = await setup();
      await openPanel(ctx);
      await openSwitcher(ctx);
      await choose(ctx, 'Expanded');
      const control = (label: string) => ctx.el.querySelector<HTMLButtonElement>(`.titlebar .window-controls button[aria-label="${label}"]`);
      return { ...ctx, control };
    };

    it('draws its own minimize, maximize and close in the title bar, labelled in the language of the Workspace', async () => {
      const { el, control } = await toExpanded();
      expect(el.querySelector('.titlebar')).not.toBeNull();
      expect(Array.from(el.querySelectorAll('.titlebar .window-controls button')).map((b) => b.getAttribute('aria-label'))).toEqual([
        'Minimizar',
        'Maximizar',
        'Cerrar',
      ]);
      expect(control('Cerrar')).not.toBeNull();
      expect(el.querySelector('button[aria-label="Close Timmy"]')).toBeNull();
    });

    it('minimizes, quits and toggles maximize through the Window RPC', async () => {
      const { control, settle, minimizes, toggles, closes } = await toExpanded();
      control('Minimizar')!.click();
      control('Maximizar')!.click();
      control('Cerrar')!.click();
      await settle();
      expect([minimizes.length, toggles.length, closes.length]).toEqual([1, 1, 1]);
    });

    it('shows maximize or restore from the state main pushes, however the window was changed', async () => {
      const { control, settle, setMaximized } = await toExpanded();
      expect(control('Maximizar')!.getAttribute('data-state')).toBe('normal');
      await setMaximized(true);
      await settle();
      expect(control('Maximizar')).toBeNull();
      expect(control('Restaurar')!.getAttribute('data-state')).toBe('maximized');
      control('Restaurar')!.click();
      await settle();
      expect(control('Maximizar')).not.toBeNull();
    });

    it('toggles maximize on double-click of the empty title bar, but not of the controls or the switcher', async () => {
      const { el, control, settle, toggles } = await toExpanded();
      const dblclick = () => new MouseEvent('dblclick', { bubbles: true });
      el.querySelector('.titlebar .drag-fill')!.dispatchEvent(dblclick());
      await settle();
      expect(toggles).toHaveLength(1);
      control('Minimizar')!.dispatchEvent(dblclick());
      control('Maximizar')?.dispatchEvent(dblclick());
      el.querySelector('.titlebar button[aria-label="Change window mode"]')!.dispatchEvent(dblclick());
      await settle();
      expect(toggles).toHaveLength(1);
    });

    it('leaves Pill and Panel without minimize or maximize', async () => {
      const ctx = await setup();
      expect(ctx.el.querySelector('.window-controls')).toBeNull();
      await openPanel(ctx);
      expect(ctx.el.querySelector('.window-controls')).toBeNull();
      expect(ctx.el.querySelector('button[aria-label="Close Timmy"]')).not.toBeNull();
    });
  });

  it('returns from Expanded to the Panel from the title bar switcher, and the Panel keeps its own header', async () => {
    const ctx = await setup();
    await openPanel(ctx);
    await openSwitcher(ctx);
    await choose(ctx, 'Expanded');
    await openExpandedSwitcher(ctx);
    await choose(ctx, 'Panel');
    expect(ctx.el.querySelector('app-workspace')).toBeNull();
    expect(ctx.el.querySelector('app-panel-terminal')).not.toBeNull();
    expect(ctx.el.querySelector('button[aria-label="Close Timmy"]')).not.toBeNull();
  });

  describe('the Pill and the Notifications from main', () => {
    const pillText = (ctx: Awaited<ReturnType<typeof setup>>) => ctx.el.querySelector('ui-pill button')?.textContent ?? '';
    const mascot = (ctx: Awaited<ReturnType<typeof setup>>) => ctx.el.querySelector('ui-pill ui-mascot');
    const source = (id: string) => ({ _tag: 'Terminal', terminalId: TerminalId.make(id) }) as const;
    const enter = (ctx: Awaited<ReturnType<typeof setup>>, id: string, type: TerminalStatus) =>
      ctx.hear({ _tag: 'Notified', notification: { source: source(id), type } });

    it('leads with the Mascot, gray when nothing is running, and has no state dot', async () => {
      const ctx = await setup();
      expect(mascot(ctx)?.getAttribute('data-status')).toBe('Idle');
      expect(ctx.el.querySelector('ui-pill .as-pill__lead ui-mascot')).not.toBeNull();
      expect(ctx.el.querySelector('ui-pill')?.classList).toContain('as-pill--lg');
      expect(ctx.el.querySelector('ui-pill .as-dot')).toBeNull();
    });

    it('shows how many Terminals are Working, and updates as they start and end, with no reload', async () => {
      const ctx = await setup();
      expect(pillText(ctx)).toContain('Nada en marcha');

      await enter(ctx, 'a', 'Working');
      await ctx.settle();
      expect(pillText(ctx)).toContain('Live');
      expect(pillText(ctx)).toContain('1 terminal en marcha');
      expect(mascot(ctx)?.getAttribute('data-status')).toBe('Working');

      await enter(ctx, 'b', 'Working');
      await ctx.settle();
      expect(pillText(ctx)).toContain('2 terminales en marcha');

      await enter(ctx, 'a', 'Done');
      await ctx.settle();
      expect(pillText(ctx)).toContain('1 terminal en marcha');
    });

    it('turns the Mascot red, with the word Error, when a Terminal exits with an error', async () => {
      const ctx = await setup();
      await enter(ctx, 'a', 'Working');
      await enter(ctx, 'a', 'Error');
      await ctx.settle();
      expect(mascot(ctx)?.getAttribute('data-status')).toBe('Error');
      expect(pillText(ctx)).toContain('Error');
      expect(pillText(ctx)).toContain('1 terminal ha fallado');
    });

    it('shows the highest-priority status of all the Terminals', async () => {
      const ctx = await setup();
      await enter(ctx, 'a', 'Done');
      await enter(ctx, 'b', 'Working');
      await ctx.settle();
      expect(mascot(ctx)?.getAttribute('data-status')).toBe('Working');
      await enter(ctx, 'c', 'Error');
      await ctx.settle();
      expect(mascot(ctx)?.getAttribute('data-status')).toBe('Error');
      await enter(ctx, 'd', 'Waiting');
      await ctx.settle();
      expect(mascot(ctx)?.getAttribute('data-status')).toBe('Waiting');
    });

    it('goes back to idle when the last Terminal is closed', async () => {
      const ctx = await setup();
      await enter(ctx, 'a', 'Working');
      await enter(ctx, 'b', 'Error');
      await ctx.settle();
      await ctx.hear({ _tag: 'Retracted', source: source('a') });
      await ctx.hear({ _tag: 'Retracted', source: source('b') });
      await ctx.settle();
      expect(mascot(ctx)?.getAttribute('data-status')).toBe('Idle');
      expect(pillText(ctx)).toContain('Idle');
      expect(pillText(ctx)).toContain('Nada en marcha');
    });

    it('does not take a Terminal that is only open in the renderer as running', async () => {
      const ctx = await setup();
      const terminals = TestBed.inject(TerminalsState);
      terminals.setState(terminals.create(ProjectId.make('p1')).id, 'Live');
      await ctx.settle();
      expect(pillText(ctx)).toContain('Nada en marcha');
    });
  });
});
