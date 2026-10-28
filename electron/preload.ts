import { contextBridge, ipcRenderer } from 'electron';
import { RPC_CONNECT_CHANNEL, RPC_PORT_MESSAGE, type DesktopBridge } from '../src/shared/rpc/handshake';

/**
 * The only bridge between the Angular renderer and the Electron main process.
 * Constant size: it only hands the renderer an RPC MessagePort.
 */
const desktop: DesktopBridge = {
  connect: () => {
    ipcRenderer.once(RPC_CONNECT_CHANNEL, (event) => {
      window.postMessage(RPC_PORT_MESSAGE, '*', [...event.ports]);
    });
    ipcRenderer.send(RPC_CONNECT_CHANNEL);
  },
};

contextBridge.exposeInMainWorld('desktop', desktop);
