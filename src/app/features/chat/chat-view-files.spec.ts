import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Stream } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import { ChatRpcs } from '../../../shared/chat/chat.rpc';
import { SessionId, TurnId } from '../../../shared/chat/ids.model';
import { FilesError } from '../../../shared/files/files-error.model';
import { FilesRpcs } from '../../../shared/files/files.rpc';
import { SessionsRpcs } from '../../../shared/sessions/sessions.rpc';
import { layerProjectsUnused, layerSettingsUnused, layerAttachmentsUnused, layerWindowUnused, makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ChatViewComponent } from './chat-view';

const unused = () => Effect.die('not under test');

const setup = async (list: (call: number) => Effect.Effect<{ paths: string[]; truncated: boolean }, FilesError>) => {
  let calls = 0;
  const sessionId = SessionId.make('s1');
  const turnId = TurnId.make('t1');
  const handlers = Layer.mergeAll(
    AppInfoRpcs.toLayer({
      'AppInfo.get': () =>
        Effect.succeed({ name: 't', version: '1', electron: '1', chrome: '1', node: '1', platform: 'win32', cwd: '/work' }),
    }),
    ChatRpcs.toLayer({
      'Chat.capabilities': unused,
      'Chat.models': () => Effect.succeed([]),
      'Chat.commands': () => Effect.succeed([]),
      'Chat.changeAdapter': unused,
      'Chat.startSession': () => Effect.succeed(sessionId),
      'Chat.send': () =>
        Stream.fromIterable([
          { _tag: 'TurnStarted' as const, sessionId, turnId },
          { _tag: 'TurnFinished' as const, sessionId, turnId, outcome: 'Completed' as const, usage: { inputTokens: 0, outputTokens: 0 } },
        ]),
      'Chat.resolvePermission': unused,
      'Chat.answerQuestion': unused,
      'Chat.interrupt': unused,
      'Chat.closeSession': () => Effect.void,
    }),
    SessionsRpcs.toLayer({
      'Sessions.list': () => Effect.succeed([]),
      'Sessions.history': unused,
      'Sessions.listSubagents': () => Effect.succeed([]),
      'Sessions.rename': unused,
      'Sessions.delete': unused,
      'Sessions.changes': () => Stream.empty,
    }),
    FilesRpcs.toLayer({ 'Files.list': () => list(++calls) }),
    layerWindowUnused,
    layerSettingsUnused, layerAttachmentsUnused,
    layerProjectsUnused,
  );
  const layer = makeDesktopTestLayer(handlers);
  await TestBed.configureTestingModule({
    imports: [ChatViewComponent],
    providers: [
      {
        provide: EffectRuntime,
        useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) },
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(ChatViewComponent);
  const el = fixture.nativeElement as HTMLElement;
  const settle = async () => {
    await fixture.whenStable();
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    await fixture.whenStable();
  };
  const type = async (text: string) => {
    const box = el.querySelector('textarea') as HTMLTextAreaElement;
    box.value = text;
    box.setSelectionRange(text.length, text.length);
    box.dispatchEvent(new Event('input'));
    await settle();
  };
  const send = async () => {
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();
  };
  fixture.detectChanges();
  await settle();
  return { el, type, send, settle, calls: () => calls };
};

const menuText = (el: HTMLElement) => el.querySelector('#mention-menu')?.textContent ?? '';

describe('ChatViewComponent file list freshness', () => {
  it('loads once per Session, then again after a Turn finishes', async () => {
    const { el, type, send, calls } = await setup((n) =>
      Effect.succeed({ paths: n === 1 ? ['old.ts'] : ['old.ts', 'created-by-agent.ts'], truncated: false }),
    );
    await type('@');
    expect(calls()).toBe(1);
    expect(menuText(el)).toContain('old.ts');
    expect(menuText(el)).not.toContain('created-by-agent.ts');

    await type('@o');
    expect(calls()).toBe(1);

    await type('hello');
    await send();
    await type('@');
    expect(calls()).toBe(2);
    expect(menuText(el)).toContain('created-by-agent.ts');
  });

  it('loads again after the window regains focus', async () => {
    const { el, type, calls } = await setup((n) => Effect.succeed({ paths: n === 1 ? ['a.ts'] : ['a.ts', 'from-editor.ts'], truncated: false }));
    await type('@');
    await type('');
    window.dispatchEvent(new Event('focus'));
    await type('@');
    expect(calls()).toBe(2);
    expect(menuText(el)).toContain('from-editor.ts');
  });

  it('says to refine the search when the list was truncated', async () => {
    const { el, type } = await setup(() => Effect.succeed({ paths: ['a.ts'], truncated: true }));
    await type('@');
    expect(menuText(el)).toContain('refina la búsqueda');
  });

  it('shows a git failure, not "no matches"', async () => {
    const { el, type } = await setup(() => Effect.fail(new FilesError({ reason: 'GitUnavailable', detail: 'git is not installed' })));
    await type('@');
    expect(menuText(el)).toContain('git is not installed');
    expect(menuText(el)).not.toContain('No files match');
  });
});
