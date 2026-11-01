import { TestBed } from '@angular/core/testing';
import { Effect, Layer, Stream } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import { SessionId } from '../../../shared/chat/ids.model';
import { SessionsRpcs } from '../../../shared/sessions/sessions.rpc';
import { ProjectId, ProviderSessionId, type SessionSummary } from '../../../shared/sessions/sessions.model';
import { layerChatUnused, layerProjectsUnused, layerSettingsUnused, layerWindowUnused, makeDesktopTestLayer } from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ChatViewComponent } from './chat-view';

const summary = (id: string, title: string): SessionSummary => ({
  sessionId: SessionId.make(id),
  projectId: ProjectId.make('p'),
  provider: 'Claude',
  providerSessionId: ProviderSessionId.make(id),
  cwd: '/work',
  title,
  createdAt: 0,
  updatedAt: 0,
});

const setup = async () => {
  const handlers = Layer.mergeAll(
    AppInfoRpcs.toLayer({
      'AppInfo.get': () =>
        Effect.succeed({ name: 't', version: '1', electron: '1', chrome: '1', node: '1', platform: 'win32', cwd: '/work' }),
    }),
    layerChatUnused,
    layerWindowUnused,
    layerSettingsUnused,
    layerProjectsUnused,
    SessionsRpcs.toLayer({
      'Sessions.list': () => Effect.succeed([summary('a', 'Alpha'), summary('b', 'Beta')]),
      'Sessions.history': ({ ref }) =>
        Effect.succeed([
          { _tag: 'Message' as const, role: 'User' as const, text: `question ${ref.sessionId}` },
          { _tag: 'ToolCall' as const, toolName: 'Read', input: '{}' },
          { _tag: 'Message' as const, role: 'Assistant' as const, text: `answer ${ref.sessionId}` },
        ]),
      'Sessions.listSubagents': () => Effect.succeed([]),
      'Sessions.rename': () => Effect.void,
      'Sessions.delete': () => Effect.void,
      'Sessions.changes': () => Stream.empty,
    }),
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

describe('ChatViewComponent Session strip', () => {
  it('lists the project Sessions and switching loads that transcript as messages with a tool tree', async () => {
    const { el, settle } = await setup();
    const chips = Array.from(el.querySelectorAll<HTMLButtonElement>('ui-chip-strip button'));
    expect(chips.map((c) => c.textContent?.trim())).toEqual(['Alpha', 'Beta']);

    chips[1].click();
    await settle();

    expect(chips[1].getAttribute('aria-pressed')).toBe('true');
    expect(chips[0].getAttribute('aria-pressed')).toBe('false');
    const messages = Array.from(el.querySelectorAll('ui-message'));
    expect(messages.map((m) => m.getAttribute('aria-label'))).toEqual(['You', 'Agent']);
    expect(messages[0].textContent).toContain('question b');
    expect(messages[1].textContent).toContain('answer b');
    expect(el.querySelector('[role="tree"] [role="treeitem"]')?.textContent).toContain('Read');

    chips[0].click();
    await settle();
    expect(el.querySelector('ui-message')?.textContent).toContain('question a');
  });
});
