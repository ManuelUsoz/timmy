import { Effect, Layer, Stream } from 'effect';
import { RpcClient, RpcTest, type Rpc, type RpcGroup } from 'effect/rpc';
import { AttachmentsRpcs } from '../../shared/attachments/attachments.rpc';
import { ChatRpcs } from '../../shared/chat/chat.rpc';
import { FilesRpcs } from '../../shared/files/files.rpc';
import { DesktopRpcs } from '../../shared/rpc/desktop-rpcs';
import { ProjectsRpcs } from '../../shared/projects/projects.rpc';
import { SessionsRpcs } from '../../shared/sessions/sessions.rpc';
import { SettingsRpcs } from '../../shared/settings/settings.rpc';
import { TerminalRpcs } from '../../shared/terminal/terminal.rpc';
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
  handlers: Layer.Layer<any>,
): Layer.Layer<DesktopApi> =>
  Layer.effect(DesktopApi, RpcTest.makeClient(DesktopRpcs)).pipe(Layer.provide(Layer.merge(handlers, layerTerminalUnused)));

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
  'Window.minimize': windowUnused,
  'Window.toggleMaximize': windowUnused,
  'Window.maximized': () => Stream.empty,
});

const terminalUnused = () => Effect.die('Terminal handler not under test');

/** Terminal handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerTerminalUnused = TerminalRpcs.toLayer({
  'Terminal.create': terminalUnused,
  'Terminal.output': terminalUnused,
  'Terminal.write': terminalUnused,
  'Terminal.resize': terminalUnused,
  'Terminal.close': terminalUnused,
});

const settingsUnused = () => Effect.die('Settings handler not under test');

/** Settings handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerSettingsUnused = SettingsRpcs.toLayer({
  'Settings.get': settingsUnused,
  'Settings.setLanguage': settingsUnused,
});

const projectsUnused = () => Effect.die('Projects handler not under test');

/** Projects handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerProjectsUnused = ProjectsRpcs.toLayer({
  'Projects.list': projectsUnused,
  'Projects.add': projectsUnused,
  'Projects.remove': projectsUnused,
  'Projects.pickFolder': projectsUnused,
  'Projects.inspectFolder': projectsUnused,
  'Projects.initGit': projectsUnused,
  'Projects.checkFolder': projectsUnused,
  'Projects.markUsed': projectsUnused,
});

/** Files handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerFilesUnused = FilesRpcs.toLayer({
  'Files.list': () => Effect.die('Files handler not under test'),
});

const attachmentsUnused = () => Effect.die('Attachments handler not under test');

/** Attachments handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerAttachmentsUnused = AttachmentsRpcs.toLayer({
  'Attachments.add': attachmentsUnused,
  'Attachments.remove': attachmentsUnused,
});
