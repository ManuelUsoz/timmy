import { Context, Effect, Layer, Queue, Stream } from 'effect';
import { RpcMessage, RpcSerialization, RpcServer } from 'effect/rpc';
import { layerPortSerialization } from '../../src/shared/rpc/message-port-protocol';

type PortData = Uint8Array | string;

/** What the server needs from a port; Electron's `MessagePortMain` satisfies it. */
export interface IpcServerPort {
  on(event: 'message', listener: (event: { data: PortData }) => void): void;
  on(event: 'close', listener: () => void): void;
  off(event: 'message', listener: (event: { data: PortData }) => void): void;
  postMessage(message: PortData): void;
  start(): void;
  close(): void;
}

/**
 * Lets the window bootstrap hand the long-lived server a fresh port on every
 * (re)load. The newest port replaces the previous one and disconnects its client.
 */
export class RpcPortHandoff extends Context.Service<
  RpcPortHandoff,
  { readonly bind: (port: IpcServerPort) => void }
>()('timmy/RpcPortHandoff') {}

interface ActivePort {
  readonly id: number;
  readonly port: IpcServerPort;
  readonly handler: (event: { data: PortData }) => void;
}

const makeProtocol = (portInbox: Queue.Queue<IpcServerPort>) =>
  RpcServer.Protocol.make(
    Effect.fnUntraced(function* (writeRequest) {
      const serialization = yield* RpcSerialization.RpcSerialization;
      const disconnects = yield* Queue.make<number>();
      const inbound = yield* Queue.make<readonly [number, RpcMessage.FromClientEncoded]>();
      let nextClientId = 0;
      let current: ActivePort | null = null;
      // The parser is stateful (partial frames), so each port gets its own.
      let parser = serialization.makeUnsafe();

      const bindPort = (port: IpcServerPort): void => {
        if (current) {
          current.port.off('message', current.handler);
          current.port.close();
          // Interrupts the replaced client's in-flight fibers (streams included).
          Queue.offerUnsafe(disconnects, current.id);
        }
        const id = nextClientId++;
        const portParser = serialization.makeUnsafe();
        parser = portParser;
        const handler = (event: { data: PortData }): void => {
          try {
            for (const message of portParser.decode(event.data)) {
              Queue.offerUnsafe(inbound, [id, message as RpcMessage.FromClientEncoded]);
            }
          } catch {
            // One malformed frame must not throw inside the raw port callback.
          }
        };
        port.on('message', handler);
        port.on('close', () => Queue.offerUnsafe(disconnects, id));
        port.start();
        current = { id, port, handler };
      };

      // Frames and ports are consumed on scoped fibers, so neither writeRequest
      // nor bindPort ever runs inside a raw port callback.
      yield* Effect.forkScoped(
        Stream.fromQueue(inbound).pipe(
          // A late frame from a swapped-out port would recreate its client as a zombie.
          Stream.runForEach(([id, message]) => (id === current?.id ? writeRequest(id, message) : Effect.void)),
        ),
      );
      yield* Effect.forkScoped(
        Stream.fromQueue(portInbox).pipe(Stream.runForEach((port) => Effect.sync(() => bindPort(port)))),
      );
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          if (current) {
            current.port.off('message', current.handler);
            current.port.close();
          }
        }),
      );

      return {
        disconnects,
        send: (clientId, response) =>
          Effect.sync(() => {
            if (current?.id !== clientId) return;
            const encoded = parser.encode(response);
            if (encoded !== undefined) current.port.postMessage(encoded);
          }),
        end: () => Effect.void,
        clientIds: Effect.sync(() => new Set(current ? [current.id] : [])),
        initialMessage: Effect.succeedNone,
        supportsAck: true,
        supportsTransferables: false,
        supportsSpanPropagation: true,
        supportsNotifications: true,
        codecFor: serialization.codecFor,
      };
    }),
  );

/** Provides the server `Protocol` plus `RpcPortHandoff` feeding it ports. */
export const layerIpcServer: Layer.Layer<RpcServer.Protocol | RpcPortHandoff> = Layer.unwrap(
  Effect.gen(function* () {
    const portInbox = yield* Queue.make<IpcServerPort>();
    return Layer.merge(
      Layer.effect(RpcServer.Protocol, makeProtocol(portInbox)),
      Layer.succeed(RpcPortHandoff, { bind: (port) => void Queue.offerUnsafe(portInbox, port) }),
    );
  }),
).pipe(Layer.provide(layerPortSerialization));
