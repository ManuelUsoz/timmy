import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Stream } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import { ChatError } from '../../../shared/chat/chat-error.model';
import { ChatRpcs } from '../../../shared/chat/chat.rpc';
import { SessionId } from '../../../shared/chat/ids.model';
import { SessionsRpcs } from '../../../shared/sessions/sessions.rpc';
import {
  layerFilesUnused,
  layerProjectsUnused,
  layerSettingsUnused,
  layerWindowUnused,
  makeDesktopTestLayer,
} from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ChatViewComponent } from './chat-view';

const unused = () => Effect.die('not under test');

const setup = async () => {
  const sent: string[] = [];
  const sessionId = SessionId.make('s1');
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
      'Chat.send': ({ text }) => {
        sent.push(text);
        return Stream.fail(new ChatError({ reason: 'InvalidMention', detail: 'Invalid mention: nope.ts' }));
      },
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
    layerWindowUnused,
    layerSettingsUnused,
    layerFilesUnused,
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
  fixture.detectChanges();
  await settle();
  return { el, settle, sent };
};

describe('ChatViewComponent invalid mentions', () => {
  it('keeps the draft, shows the error and leaves no message in the transcript', async () => {
    const { el, settle, sent } = await setup();
    const box = el.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'read @nope.ts please';
    box.setSelectionRange(box.value.length, box.value.length);
    box.dispatchEvent(new Event('input'));
    await settle();
    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(sent).toEqual(['read @nope.ts please']);
    expect(el.querySelector('.error')?.textContent).toContain('nope.ts');
    expect((el.querySelector('textarea') as HTMLTextAreaElement).value).toBe('read @nope.ts please');
    expect(el.textContent).not.toContain('Thinking');
  });
});
