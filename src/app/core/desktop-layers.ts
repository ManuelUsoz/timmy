import { Effect, Layer, Stream } from 'effect';
import { RpcClient, RpcTest, type Rpc, type RpcGroup } from 'effect/rpc';
import { FilesRpcs } from '../../shared/files/files.rpc';
import { NotificationRpcs } from '../../shared/notification/notification.rpc';
import { DesktopRpcs } from '../../shared/rpc/desktop-rpcs';
import { ProjectsRpcs } from '../../shared/projects/projects.rpc';
import { SettingsRpcs } from '../../shared/settings/settings.rpc';
import { TerminalRpcs } from '../../shared/terminal/terminal.rpc';
import { WindowRpcs } from '../../shared/window/window.rpc';
import { WorkspaceRpcs } from '../../shared/workspace/workspace.rpc';
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
  Layer.effect(DesktopApi, RpcTest.makeClient(DesktopRpcs)).pipe(Layer.provide(Layer.mergeAll(layerTerminalUnused, layerNotificationUnused, layerWorkspaceUnused, handlers)));

/** Workspace handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerWorkspaceUnused = WorkspaceRpcs.toLayer({
  'Workspace.load': () => Effect.die('Workspace handler not under test'),
  'Workspace.save': () => Effect.die('Workspace handler not under test'),
  'Workspace.renameTerminal': () => Effect.die('Workspace handler not under test'),
  // WorkspacePersistence listens from the start in every Workspace test: nobody quits, and the answer is accepted.
  'Workspace.quitting': () => Stream.empty,
  'Workspace.saved': () => Effect.void,
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
  'Window.cursor': () => Stream.empty,
});

const terminalUnused = () => Effect.die('Terminal handler not under test');

/** Terminal handlers that die when called, so a test of another domain can still build `DesktopRpcs`; spread it to replace a few. */
export const terminalUnusedHandlers = {
  'Terminal.create': terminalUnused,
  'Terminal.output': terminalUnused,
  'Terminal.activity': terminalUnused,
  // The Files browser listens from the start: nobody's Hook reports anything.
  'Terminal.hookReports': () => Stream.empty,
  'Terminal.focus': terminalUnused,
  'Terminal.show': terminalUnused,
  'Terminal.write': terminalUnused,
  'Terminal.resize': terminalUnused,
  'Terminal.close': terminalUnused,
} satisfies Parameters<typeof TerminalRpcs.toLayer>[0];

export const layerTerminalUnused = TerminalRpcs.toLayer(terminalUnusedHandlers);

/** Notification handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerNotificationUnused = NotificationRpcs.toLayer({
  'Notification.subscribe': () => Stream.die('Notification handler not under test'),
});

const settingsUnused = () => Effect.die('Settings handler not under test');

/** Settings handlers that die when called, so a test of another domain can still build `DesktopRpcs`. */
export const layerSettingsUnused = SettingsRpcs.toLayer({
  'Settings.get': settingsUnused,
  'Settings.setLanguage': settingsUnused,
  'Settings.setProvider': settingsUnused,
  'Settings.setChannel': settingsUnused,
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
  'Files.listDir': () => Effect.die('Files handler not under test'),
  'Files.read': () => Effect.die('Files handler not under test'),
  'Files.openExternal': () => Effect.die('Files handler not under test'),
  'Files.changes': () => Effect.die('Files handler not under test'),
  'Files.getState': () => Effect.die('Files handler not under test'),
  'Files.saveState': () => Effect.die('Files handler not under test'),
  'Files.saveWidth': () => Effect.die('Files handler not under test'),
});
