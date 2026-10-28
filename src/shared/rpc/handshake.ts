/** IPC channel the preload sends on to ask main for an RPC MessagePort. */
export const RPC_CONNECT_CHANNEL = 'desktop:rpc-connect' as const;

/** `data` tag of the window message that carries the transferred RPC port. */
export const RPC_PORT_MESSAGE = 'desktop:rpc-port' as const;

/**
 * The complete surface exposed to the renderer as `window.desktop`.
 * Constant size: all domain calls go through the RPC port, never through here.
 */
export interface DesktopBridge {
  readonly connect: () => void;
}
