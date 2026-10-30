import { TestBed } from '@angular/core/testing';
import { Effect, Layer, PubSub, Ref, Stream } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import { SettingsRpcs } from '../../../shared/settings/settings.rpc';
import { WindowRpcs } from '../../../shared/window/window.rpc';
import type { WindowMode } from '../../../shared/window/window.model';
import { ChatRpcs } from '../../../shared/chat/chat.rpc';
import { AgentId, MessageId, OptionId, PermissionRequestId, ToolCallId } from '../../../shared/chat/ids.model';
import type { PermissionResponse } from '../../../shared/chat/permission.model';
import type { ToolCall } from '../../../shared/chat/tool-call.model';
import { ChatController } from '../chat/chat-controller';
import { addUserMessage, initialChatState } from '../chat/chat-state';
import { layerSessionsUnused, makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { provideWorkspaceRouter } from '../workspace/workspace.routes';
import { ShellComponent } from './shell';

/** Real client against fake handlers: the window is just a Ref, like main's service behind its host. */
const setup = async () => {
  const answers: PermissionResponse[] = [];
  const closes: number[] = [];
  const minimizes: number[] = [];
  const toggles: number[] = [];
  const maximized = Ref.makeUnsafe(false);
  const maximizedChanges = Effect.runSync(PubSub.unbounded<boolean>());
  /** What main does when its window is maximized or restored, by the user or by the system. */
  const setMaximized = (value: boolean) =>
    Effect.runPromise(Ref.set(maximized, value).pipe(Effect.andThen(PubSub.publish(maximizedChanges, value)), Effect.asVoid));
  const unused = () => Effect.die('not under test');
  const layerChat = ChatRpcs.toLayer({
    'Chat.capabilities': unused,
    'Chat.models': unused,
    'Chat.commands': unused,
    'Chat.changeAdapter': unused,
    'Chat.startSession': unused,
    'Chat.send': unused,
    'Chat.resolvePermission': ({ response }) => Effect.sync(() => void answers.push(response)),
    'Chat.answerQuestion': unused,
    'Chat.interrupt': unused,
    'Chat.closeSession': unused,
  });
  const mode = Ref.makeUnsafe<WindowMode>('Pill');
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
    layerChat,
    layerSessionsUnused,
    SettingsRpcs.toLayer({
      'Settings.get': () => Effect.succeed({ language: 'es' as const }),
      'Settings.setLanguage': ({ language }) => Effect.succeed({ language }),
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
  return { el, settle, fixture, answers, closes, minimizes, toggles, setMaximized };
};

describe('ShellComponent', () => {
  it('starts as the Pill, Idle, with real buttons for the pill and the switcher', async () => {
    const { el } = await setup();
    expect(el.querySelector('app-chat-view')).toBeNull();
    expect(el.querySelector('ui-pill button')?.textContent).toContain('Idle');
    expect(el.querySelector('button[aria-label="Change window mode"]')).not.toBeNull();
  });

  it('opens the Panel on double-click of the Pill', async () => {
    const { el, settle } = await setup();
    el.querySelector('ui-pill')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(el.querySelector('app-chat-view')).not.toBeNull();
  });

  it('opens the Panel from the switcher button in the Pill', async () => {
    const { el, settle } = await setup();
    (el.querySelector('button[aria-label="Change window mode"]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('app-chat-view')).not.toBeNull();
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
    expect((el.querySelector('app-chat-view') !== null)).toBe(from === 'Panel');
  });

  it('returns to the Pill on double-click of the Panel header, and ignores Escape', async () => {
    const { el, settle } = await setup();
    el.querySelector('ui-pill')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(el.querySelector('app-chat-view')).not.toBeNull();
    el.querySelector('.panel-header')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await settle();
    expect(el.querySelector('app-chat-view')).toBeNull();
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
    expect(ctx.el.querySelector('app-chat-view')).toBeNull();
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
    expect(ctx.el.querySelector('app-chat-view')).not.toBeNull();
    expect(ctx.el.querySelector('button[aria-label="Close Timmy"]')).not.toBeNull();
  });

  describe('Asks', () => {
    const ask = async () => {
      const ctx = await setup();
      const controller = TestBed.inject(ChatController);
      (controller as unknown as { sessionId: string }).sessionId = 's1';
      const call = { id: ToolCallId.make('t'), agentId: AgentId.make('a'), name: 'Bash', title: 'git push', status: 'Running', kind: 'Edit' } as ToolCall;
      controller.chat.set({
        ...initialChatState,
        running: true,
        permission: {
          id: PermissionRequestId.make('r'),
          agentId: AgentId.make('a'),
          toolCall: call,
          options: [
            { id: OptionId.make('allow'), label: 'Allow', kind: 'AllowOnce' },
            { id: OptionId.make('deny'), label: 'Deny', kind: 'RejectOnce' },
          ],
        },
      });
      await ctx.settle();
      return { ...ctx, controller };
    };

    it('puts the Pill in Asks with the request and a Review action that opens the Panel', async () => {
      const { el, settle } = await ask();
      const pill = el.querySelector('ui-pill')!;
      expect(pill.textContent).toContain('Asks');
      expect(pill.textContent).toContain('Bash git push');
      expect(pill.querySelector('.as-pill__action')?.textContent).toContain('Review');
      pill.querySelector('button')!.click();
      await settle();
      expect(el.querySelector('app-chat-view')).not.toBeNull();
    });

    it('shows the ask row above the composer, not an inline card, with named buttons', async () => {
      const { el, settle } = await ask();
      el.querySelector('ui-pill button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
      const row = el.querySelector('ui-ask-row')!;
      expect(row.nextElementSibling?.classList.contains('composer')).toBe(true);
      expect(el.querySelector('.log ui-session')).toBeNull();
      expect(row.querySelector('button[aria-label="Allow: Bash git push"]')).not.toBeNull();
      expect(row.querySelector('button[aria-label="Deny: Bash git push"]')).not.toBeNull();
    });

    it.each([
      ['Allow', 'allow'],
      ['Deny', 'deny'],
    ])('%s sends the matching response', async (name, optionId) => {
      const { el, settle, answers, controller } = await ask();
      el.querySelector('ui-pill button')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await settle();
      (el.querySelector(`ui-ask-row button[aria-label^="${name}:"]`) as HTMLButtonElement).click();
      await settle();
      expect(answers).toEqual([{ _tag: 'Selected', requestId: 'r', optionId }]);
      controller.chat.update((c) => ({ ...c, permission: undefined }));
      await settle();
      expect(el.querySelector('ui-ask-row')).toBeNull();
    });
  });

  it('shows Done with a summary, then Idle on the next Turn', async () => {
    const { el, settle, fixture } = await setup();
    const chat = TestBed.inject(ChatController);
    const assistant = { kind: 'Assistant', agentId: AgentId.make('r'), messageId: MessageId.make('m'), text: 'All green.', thinking: '' } as const;
    chat.chat.set({ ...initialChatState, items: [assistant] });
    fixture.detectChanges();
    await settle();
    expect(el.querySelector('ui-pill button')?.textContent).toContain('Done');
    expect(el.querySelector('ui-pill button')?.textContent).toContain('All green.');
    chat.chat.set(addUserMessage(chat.chat(), 'again'));
    fixture.detectChanges();
    await settle();
    expect(el.querySelector('ui-pill button')?.textContent).toContain('Idle');
  });

  it('shows the running subagent count in the Pill', async () => {
    const { el, settle, fixture } = await setup();
    const chat = TestBed.inject(ChatController);
    const id = AgentId.make('a');
    chat.chat.set({ ...initialChatState, running: true, agents: new Map([[id, { info: { id, parentId: AgentId.make('r'), name: 'a' }, status: 'Running', usage: undefined }]]) });
    fixture.detectChanges();
    await settle();
    expect(el.querySelector('ui-pill [data-count="subagents"]')?.textContent).toContain('1');
  });
});
