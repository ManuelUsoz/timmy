import type { DesktopBridge } from '../shared/rpc/handshake';

declare global {
  interface Window {
    /** Injected by electron/preload.ts via contextBridge. */
    desktop?: DesktopBridge;
  }
}
