import { Effect, Layer, Stream } from 'effect';
import { RpcClient, RpcTest, type Rpc, type RpcGroup } from 'effect/rpc';
import { ChatRpcs } from '../../shared/chat/chat.rpc';
import { DesktopRpcs } from '../../shared/rpc/desktop-rpcs';
import { SessionsRpcs } from '../../shared/sessions/sessions.rpc';
import { SettingsRpcs } from '../../shared/settings/settings.rpc';
import { WindowRpcs } from '../../shared/window/window.rpc';
import { layerClientProtocol } from '../../shared/rpc/message-port-protocol';
import { DesktopApi } from './desktop-api';
import type { DesktopBridgeError } from './desktop-error';
import { acquireDesktopPort } from './desktop-port';

/** Production implementation: an RPC client over a fresh port, closed with the scope. */
export const layerDesktop: Layer.Layer<DesktopApi, DesktopBridgeError> = Layer.unwrap(
  Effect.map(acquireDesktopPort, (port) =>
    Layer.effect(DesktopApi, RpcClient.make(DesktopRpcs)).pipe(
      Layer.provide(layerClientProtocol(port)),
    ),
  ),
);

/**
 * Test implementation: the real client served in-memory by the given handlers,
 * so tests exercise the same contract as production.
 */
export const makeDesktopTestLayer = (
  handlers: Layer.Layer<Rpc.ToHandler<RpcGroup.Rpcs<typeof DesktopRpcs>>>,
): Layer.Layer<DesktopApi> =>
  Layer.effect(DesktopApi, RpcTest.makeClient(DesktopRpcs)).pipe(Layer.provide(handlers));

const unused = () => Effect.die('Chat handler not under test');

/** Chat handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerChatUnused = ChatRpcs.toLayer({
  'Chat.capabilities': unused,
  'Chat.models': unused,
  'Chat.commands': unused,
  'Chat.changeAdapter': unused,
  'Chat.startSession': unused,
  'Chat.send': unused,
  'Chat.resolvePermission': unused,
  'Chat.answerQuestion': unused,
  'Chat.interrupt': unused,
  'Chat.closeSession': unused,
});

const sessionsUnused = () => Effect.die('Sessions handler not under test');

/** Sessions handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerSessionsUnused = SessionsRpcs.toLayer({
  'Sessions.list': sessionsUnused,
  'Sessions.history': sessionsUnused,
  'Sessions.listSubagents': sessionsUnused,
  'Sessions.rename': sessionsUnused,
  'Sessions.delete': sessionsUnused,
  'Sessions.changes': () => Stream.empty,
});

const windowUnused = () => Effect.die('Window handler not under test');

/** Window handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerWindowUnused = WindowRpcs.toLayer({
  'Window.current': windowUnused,
  'Window.request': windowUnused,
  'Window.close': windowUnused,
});

const settingsUnused = () => Effect.die('Settings handler not under test');

/** Settings handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerSettingsUnused = SettingsRpcs.toLayer({
  'Settings.get': settingsUnused,
  'Settings.setLanguage': settingsUnused,
});
