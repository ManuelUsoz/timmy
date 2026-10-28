import { Effect, Layer } from 'effect';
import { RpcClient, RpcMessage, RpcSerialization } from 'effect/rpc';

/**
 * Minimal port shape the renderer's DOM `MessagePort` adapts to. Data is the
 * serialized RPC frame. (The main side uses `IpcServerPort`, see electron/rpc/ipc-server.ts.)
 */
export interface MessagePortAdapter {
  readonly postMessage: (data: Uint8Array | string) => void;
  readonly onMessage: (callback: (data: Uint8Array | string) => void) => void;
  readonly close: () => void;
}

// NOTE: effect 4.0.7 ships no MsgPack serialization; the binary one is layerSchemaBinary.
export const layerPortSerialization = RpcSerialization.layerSchemaBinary();

/** Client `Protocol` over a port. Requires `RpcSerialization`. */
export const makeClientProtocol = (port: MessagePortAdapter) =>
  RpcClient.Protocol.make(
    Effect.fnUntraced(function* (writeResponse) {
      const serialization = yield* RpcSerialization.RpcSerialization;
      const parser = serialization.makeUnsafe();
      port.onMessage((data) => {
        try {
          for (const response of parser.decode(data) as ReadonlyArray<RpcMessage.FromServerEncoded>) {
            if (response._tag === 'Pong') continue;
            Effect.runFork(writeResponse(0, response));
          }
        } catch {
          // One malformed frame must not throw inside the raw port callback.
        }
      });
      yield* Effect.addFinalizer(() => Effect.sync(() => port.close()));
      return {
        send: (_clientId, request) =>
          Effect.sync(() => {
            const encoded = parser.encode(request);
            if (encoded !== undefined) port.postMessage(encoded);
          }),
        supportsAck: true,
        supportsTransferables: false,
        codecFor: serialization.codecFor,
      };
    }),
  );

export const layerClientProtocol = (port: MessagePortAdapter) =>
  Layer.effect(RpcClient.Protocol, makeClientProtocol(port)).pipe(Layer.provide(layerPortSerialization));
