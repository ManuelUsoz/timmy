import { Effect } from 'effect';
import { RPC_PORT_MESSAGE } from '../../shared/rpc/handshake';
import type { MessagePortAdapter } from '../../shared/rpc/message-port-protocol';
import { DesktopBridgeError } from './desktop-error';

const CONNECT_TIMEOUT = '5 seconds';

const adaptPort = (port: MessagePort): MessagePortAdapter => ({
  postMessage: (data) => port.postMessage(data),
  onMessage: (callback) => {
    port.onmessage = (event: MessageEvent<Uint8Array | string>) => callback(event.data);
    port.start();
  },
  close: () => port.close(),
});

/**
 * Asks the preload for a fresh RPC port and waits for it to arrive as a tagged
 * window message. Only messages posted by this window itself are accepted.
 */
export const acquireDesktopPort: Effect.Effect<MessagePortAdapter, DesktopBridgeError> = Effect.suspend(
  () => {
    const bridge = window.desktop;

    if (!bridge) {
      return Effect.fail(
        new DesktopBridgeError({
          reason: 'NotInElectron',
          detail:
            'Not running inside Electron. Start the desktop app with `npm run dev` or `npm run preview`.',
        }),
      );
    }

    return Effect.callback<MessagePortAdapter>((resume) => {
      const listener = (event: MessageEvent) => {
        const port = event.ports[0];
        if (event.source !== window || event.data !== RPC_PORT_MESSAGE || !port) return;
        window.removeEventListener('message', listener);
        resume(Effect.succeed(adaptPort(port)));
      };
      window.addEventListener('message', listener);
      bridge.connect();
      return Effect.sync(() => window.removeEventListener('message', listener));
    }).pipe(
      Effect.timeoutOrElse({
        duration: CONNECT_TIMEOUT,
        orElse: () =>
          Effect.fail(
            new DesktopBridgeError({
              reason: 'ConnectTimeout',
              detail: 'The desktop shell did not hand over an RPC port in time.',
            }),
          ),
      }),
    );
  },
);
