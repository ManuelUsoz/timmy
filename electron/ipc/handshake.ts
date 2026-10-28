import { ipcMain, MessageChannelMain } from 'electron';
import { Effect } from 'effect';
import { RPC_CONNECT_CHANNEL } from '../../src/shared/rpc/handshake';
import { RpcPortHandoff } from '../rpc/ipc-server';
import { MainRuntime } from '../rpc/runtime';

/** Must match the origin rule used for navigation in main.ts. */
const allowedOrigin = (): string => process.env['ELECTRON_RENDERER_URL'] ?? 'file://';

const bindPort = Effect.fnUntraced(function* (port: Parameters<RpcPortHandoff['Service']['bind']>[0]) {
  const handoff = yield* RpcPortHandoff;
  handoff.bind(port);
});

/**
 * Hands the renderer one end of a fresh MessageChannel and binds the other to
 * the app-lifetime RPC server. A new connect (reload) replaces the previous
 * port; a destroyed webContents closes its port, which disconnects the client.
 */
export const registerHandshakeIpc = (): void => {
  ipcMain.on(RPC_CONNECT_CHANNEL, (event) => {
    const frame = event.senderFrame;
    if (!frame || frame !== event.sender.mainFrame || !frame.url.startsWith(allowedOrigin())) return;

    const { port1, port2 } = new MessageChannelMain();
    void MainRuntime.runPromise(bindPort(port1)).then(() => {
      event.sender.postMessage(RPC_CONNECT_CHANNEL, null, [port2]);
    });
  });
};
