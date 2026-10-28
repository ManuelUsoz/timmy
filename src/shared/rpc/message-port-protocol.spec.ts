import { describe, expect, it } from '@effect/vitest';
import { Effect, Exit, Fiber, Queue, Schema } from 'effect';
import { Rpc, RpcClient, RpcSerialization } from 'effect/rpc';
import { AppInfoRpcs, type AppInfo } from '../app-info/app-info.rpc';
import { layerClientProtocol, layerPortSerialization, type MessagePortAdapter } from './message-port-protocol';

const appInfo: AppInfo = {
  name: 'timmy',
  version: '0.1.0',
  electron: '45.1.0',
  chrome: '156.0.0.0',
  node: '24.0.0',
  platform: 'win32',
};

const serialization = Effect.gen(function* () {
  const service = yield* RpcSerialization.RpcSerialization;
  return { parser: service.makeUnsafe(), codecFor: service.codecFor };
}).pipe(Effect.provide(layerPortSerialization));

/** In-memory port: records what the client sends, lets the test push server frames. */
const makeFakePort = Effect.gen(function* () {
  const sent = yield* Queue.make<Uint8Array | string>();
  let deliver: (data: Uint8Array | string) => void = () => {};
  let closed = 0;
  const port: MessagePortAdapter = {
    postMessage: (data) => void Queue.offerUnsafe(sent, data),
    onMessage: (callback) => {
      deliver = callback;
    },
    close: () => {
      closed++;
    },
  };
  return { port, sent, push: (data: Uint8Array | string) => deliver(data), closedCount: () => closed };
});

const requestIdOf = (frame: unknown): string => {
  const [request] = frame as ReadonlyArray<{ readonly _tag: string; readonly id: string }>;
  expect(request._tag).toBe('Request');
  return request.id;
};

/** The server's reply frame for `AppInfo.get`, encoded as the real server would. */
const encodeSuccess = Effect.fnUntraced(function* (requestId: string) {
  const { parser, codecFor } = yield* serialization;
  const rpc = AppInfoRpcs.requests.get('AppInfo.get')!;
  const exit = yield* Schema.encodeUnknownEffect(codecFor(Rpc.exitSchema(rpc)))(Exit.succeed(appInfo));
  return parser.encode({ _tag: 'Exit', requestId, exit })!;
});

type Fake = Effect.Success<typeof makeFakePort>;
type Client = Effect.Success<ReturnType<typeof makeClient>>;

const makeClient = () => RpcClient.make(AppInfoRpcs);

/** Runs `use` with a client wired to `fake`; the protocol layer lives as long as `use`. */
const withClient = <A, E>(fake: Fake, use: (client: Client) => Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const client = yield* makeClient();
    return yield* use(client);
  }).pipe(Effect.provide(layerClientProtocol(fake.port)), Effect.scoped);

describe('makeClientProtocol', () => {
  it.effect('sends a request frame and resolves with the decoded response', () =>
    Effect.gen(function* () {
      const { parser } = yield* serialization;
      const fake = yield* makeFakePort;
      const result = yield* withClient(fake, (client) =>
        Effect.gen(function* () {
          const fiber = yield* Effect.forkChild(client['AppInfo.get']());
          const id = requestIdOf(parser.decode(yield* Queue.take(fake.sent)));
          fake.push(yield* encodeSuccess(id));
          return yield* Fiber.join(fiber);
        }),
      );
      expect(result).toEqual(appInfo);
    }),
  );

  it.effect('does not throw on a malformed frame and keeps sending requests', () =>
    Effect.gen(function* () {
      const { parser } = yield* serialization;
      const fake = yield* makeFakePort;
      yield* withClient(fake, (client) =>
        Effect.gen(function* () {
          expect(() => fake.push(new Uint8Array([0xff, 0xfe, 0xfd, 0x00]))).not.toThrow();
          yield* Effect.forkChild(client['AppInfo.get']());
          requestIdOf(parser.decode(yield* Queue.take(fake.sent)));
        }),
      );
    }),
  );

  it.effect('ignores Pong frames and closes the port when the scope ends', () =>
    Effect.gen(function* () {
      const { parser } = yield* serialization;
      const fake = yield* makeFakePort;
      yield* withClient(fake, () =>
        Effect.sync(() => {
          expect(() => fake.push(parser.encode({ _tag: 'Pong' })!)).not.toThrow();
          expect(fake.closedCount()).toBe(0);
        }),
      );
      expect(fake.closedCount()).toBe(1);
    }),
  );
});
