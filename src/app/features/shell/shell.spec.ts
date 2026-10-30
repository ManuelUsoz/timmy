import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Ref } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import { WindowRpcs } from '../../../shared/window/window.rpc';
import type { WindowMode } from '../../../shared/window/window.model';
import { layerChatUnused, layerSessionsUnused, makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { AgentId, MessageId } from '../../../shared/chat/ids.model';
import { addUserMessage, initialChatState } from '../chat/chat-state';
import { ChatController } from '../chat/chat-controller';
import { ShellComponent } from './shell';

/** Real client against fake handlers: the window is just a Ref, like main's service behind its host. */
const setup = async () => {
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
    layerChatUnused,
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
  return { el, settle, fixture };
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
