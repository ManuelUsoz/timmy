import { registerHandshakeIpc } from './handshake';

/**
 * Composition root for IPC handlers.
 *
 * `main.ts` calls this once, before creating the window. Domain calls go over
 * the RPC port (see electron/rpc); only the port handshake lives on ipcMain.
 */
export const registerIpc = (): void => {
  registerHandshakeIpc();
};
