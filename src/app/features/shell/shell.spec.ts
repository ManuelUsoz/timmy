import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Ref } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import { WindowRpcs } from '../../../shared/window/window.rpc';
import type { WindowMode } from '../../../shared/window/window.model';
import { ChatRpcs } from '../../../shared/chat/chat.rpc';
import { AgentId, OptionId, PermissionRequestId, ToolCallId } from '../../../shared/chat/ids.model';
import type { PermissionResponse } from '../../../shared/chat/permission.model';
import type { ToolCall } from '../../../shared/chat/tool-call.model';
import { ChatController } from '../chat/chat-controller';
import { initialChatState } from '../chat/chat-state';
import { layerSessionsUnused, makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ShellComponent } from './shell';

/** Real client against fake handlers: the window is just a Ref, like main's service behind its host. */
const setup = async () => {
  const answers: PermissionResponse[] = [];
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
    }),
    layerChat,
    layerSessionsUnused,
  );
  const layer = makeDesktopTestLayer(handlers);
  await TestBed.configureTestingModule({
    imports: [ShellComponent],
    providers: [{ provide: EffectRuntime, useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) } }],
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
  return { el, settle, fixture, answers };
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

  it('offers only the other mode from the switcher and switches with it', async () => {
    const { el, settle } = await setup();
    (el.querySelector('button[aria-label="Change window mode"]') as HTMLButtonElement).click();
    await settle();
    const options = Array.from(el.querySelectorAll('ui-option')).map((o) => o.textContent?.trim());
    expect(options).toEqual(['Panel']);
    (el.querySelector('ui-option') as HTMLElement).click();
    await settle();
    expect(el.querySelector('app-chat-view')).not.toBeNull();
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
});