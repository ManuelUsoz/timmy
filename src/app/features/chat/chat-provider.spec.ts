import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { Effect, Layer, Stream } from 'effect';
import { AppInfoRpcs } from '../../../shared/app-info/app-info.rpc';
import { AttachmentsRpcs } from '../../../shared/attachments/attachments.rpc';
import { ChatError } from '../../../shared/chat/chat-error.model';
import { ChatRpcs } from '../../../shared/chat/chat.rpc';
import { SessionId } from '../../../shared/chat/ids.model';
import type { AdapterCapabilities, ProviderId } from '../../../shared/chat/provider.model';
import type { SessionOptions } from '../../../shared/chat/session.model';
import { SessionsRpcs } from '../../../shared/sessions/sessions.rpc';
import {
  layerFilesUnused,
  layerProjectsUnused,
  layerSettingsUnused,
  layerWindowUnused,
  makeDesktopTestLayer,
} from '../../core/desktop-layers';
import { EffectRuntime } from '../../core/effect-runtime';
import { ChatController } from './chat-controller';

const unused = () => Effect.die('not under test');

const capabilities = (provider: ProviderId): AdapterCapabilities => ({
  provider,
  subagents: false,
  toolCalls: true,
  permissions: true,
  questions: false,
  thinking: false,
  resume: true,
  images: true,
  mentions: 'native',
});

const MODELS = {
  Claude: [{ id: 'claude-opus-5-5', efforts: ['Default' as const] }],
  OpenCode: [{ id: 'opencode/big-pickle', efforts: ['Default' as const] }],
} as const;

const setup = async (unavailable?: string) => {
  const started: SessionOptions[] = [];
  let active: ProviderId = 'Claude';
  const handlers = Layer.mergeAll(
    AppInfoRpcs.toLayer({
      'AppInfo.get': () =>
        Effect.succeed({ name: 't', version: '1', electron: '1', chrome: '1', node: '1', platform: 'win32', cwd: '/work' }),
    }),
    ChatRpcs.toLayer({
      'Chat.capabilities': () => Effect.succeed(capabilities(active)),
      'Chat.models': () => Effect.succeed(MODELS[active as 'Claude' | 'OpenCode']),
      'Chat.commands': () => Effect.succeed([]),
      'Chat.changeAdapter': ({ provider }) => {
        if (provider === 'OpenCode' && unavailable !== undefined) {
          return Effect.fail(new ChatError({ reason: 'ProviderNotInstalled', detail: unavailable }));
        }
        active = provider;
        return Effect.succeed(capabilities(provider));
      },
      'Chat.startSession': (options) =>
        Effect.sync(() => {
          started.push(options);
          return SessionId.make('s1');
        }),
      'Chat.send': () => Stream.empty,
      'Chat.resolvePermission': unused,
      'Chat.answerQuestion': unused,
      'Chat.interrupt': unused,
      'Chat.closeSession': () => Effect.void,
    }),
    AttachmentsRpcs.toLayer({ 'Attachments.add': unused, 'Attachments.remove': () => Effect.void }),
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
  TestBed.configureTestingModule({
    providers: [
      {
        provide: EffectRuntime,
        useValue: { run: (e: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(e as never, layer)) },
      },
    ],
  });
  const controller = TestBed.inject(ChatController);
  const settle = () => new Promise((resolve) => setTimeout(resolve, 20));
  await settle();
  return { controller, started, settle };
};

describe('ChatController provider', () => {
  it('lists the chosen Provider\'s models in place of the previous one\'s', async () => {
    const { controller, settle } = await setup();
    expect(controller.modelOptions().map((o) => o.value)).toEqual(['claude-opus-5-5']);

    controller.setProvider('OpenCode');
    await settle();

    expect(controller.provider()).toBe('OpenCode');
    expect(controller.modelOptions().map((o) => o.value)).toEqual(['opencode/big-pickle']);
    expect(controller.providerError()).toBeNull();
  });

  it('starts the Session with the chosen Provider', async () => {
    const { controller, started, settle } = await setup();
    controller.setProvider('OpenCode');
    await settle();

    controller.draft.set('hello');
    controller.send();
    await settle();

    expect(started.map((o) => o.provider)).toEqual(['OpenCode']);
  });

  it('shows the Adapter\'s error and keeps the previous Provider when the new one is unavailable', async () => {
    const { controller, settle } = await setup('OpenCode is not installed.');

    controller.setProvider('OpenCode');
    await settle();

    expect(controller.providerError()).toBe('OpenCode is not installed.');
    expect(controller.provider()).toBe('Claude');
    expect(controller.modelOptions().map((o) => o.value)).toEqual(['claude-opus-5-5']);
  });

  it('cannot change Provider once a Session is open', async () => {
    const { controller, settle } = await setup();
    controller.draft.set('hello');
    controller.send();
    await settle();
    TestBed.tick();

    expect(controller.providerLocked()).toBe(true);
  });
});
