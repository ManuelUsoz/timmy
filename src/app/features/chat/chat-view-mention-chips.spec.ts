import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Stream } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import { ChatRpcs } from '../../../shared/chat/chat.rpc';
import { SessionId } from '../../../shared/chat/ids.model';
import { SessionsRpcs } from '../../../shared/sessions/sessions.rpc';
import { ProjectId, ProviderSessionId, type SessionSummary } from '../../../shared/sessions/sessions.model';
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

const summary: SessionSummary = {
  sessionId: SessionId.make('a'),
  projectId: ProjectId.make('p'),
  provider: 'Claude',
  providerSessionId: ProviderSessionId.make('a'),
  cwd: '/work',
  title: 'Alpha',
  createdAt: 0,
  updatedAt: 0,
};

const HISTORY_TEXT = 'look at @src/a.ts, and @"my dir/b c.ts" or mail me@x.com';

const setup = async () => {
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
      'Chat.startSession': () => Effect.succeed(SessionId.make('live')),
      'Chat.send': () => Stream.never,
      'Chat.resolvePermission': unused,
      'Chat.answerQuestion': unused,
      'Chat.interrupt': unused,
      'Chat.closeSession': () => Effect.void,
    }),
    SessionsRpcs.toLayer({
      'Sessions.list': () => Effect.succeed([summary]),
      'Sessions.history': () =>
        Effect.succeed([{ _tag: 'Message' as const, role: 'User' as const, text: HISTORY_TEXT }]),
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
  return { el, settle };
};

const chipNames = (el: HTMLElement) =>
  Array.from(el.querySelectorAll('ui-message ui-chip.mention-chip')).map((c) => c.textContent?.trim());

describe('ChatViewComponent mention chips', () => {
  it('renders Mentions of a reopened session as chips and leaves emails and punctuation as text', async () => {
    const { el, settle } = await setup();
    el.querySelector<HTMLButtonElement>('ui-chip-strip button')!.click();
    await settle();

    expect(chipNames(el)).toEqual(['a.ts', 'b c.ts']);
    const message = el.querySelector('ui-message')!;
    expect(message.textContent).toContain('me@x.com');
    expect(message.textContent).toContain(', and');
    expect(message.textContent).not.toContain('@src/a.ts');
  });

  it('renders Mentions of a message as it is sent, and the composer shows none while typing', async () => {
    const { el, settle } = await setup();
    const box = el.querySelector('textarea') as HTMLTextAreaElement;
    box.value = 'read @src/a.ts now';
    box.setSelectionRange(box.value.length, box.value.length);
    box.dispatchEvent(new Event('input'));
    await settle();
    expect(el.querySelectorAll('ui-chip.mention-chip').length).toBe(0);

    el.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
    await settle();

    expect(chipNames(el)).toEqual(['a.ts']);
  });
});
