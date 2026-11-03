import { describe, expect, it } from '@effect/vitest';
import { Effect, Exit, Layer, Queue, Schema } from 'effect';
import { Rpc, RpcSerialization, RpcServer } from 'effect/rpc';
import { AppInfoRpcs, type AppInfo } from '../../src/shared/app-info/app-info.rpc';
import { layerPortSerialization } from '../../src/shared/rpc/message-port-protocol';
import { layerIpcServer, RpcPortHandoff, type IpcServerPort } from './ipc-server';

const appInfo: AppInfo = {
  name: 'timmy',
  version: '0.1.0',
  electron: '45.1.0',
  chrome: '156.0.0.0',
  node: '24.0.0',
  platform: 'win32',
  cwd: '/work',
};

const handlers = AppInfoRpcs.toLayer({ 'AppInfo.get': () => Effect.succeed(appInfo) });

const layerServer = RpcServer.layer(AppInfoRpcs).pipe(
  Layer.provide(handlers),
  Layer.provideMerge(layerIpcServer),
);

type Frame = Uint8Array | string;
type MessageListener = (event: { data: Frame }) => void;

const makeFakePort = Effect.gen(function* () {
  const sent = yield* Queue.make<Frame>();
  const listeners = new Set<MessageListener>();
  const state = { started: 0, closed: 0 };
  const port: IpcServerPort = {
    on: (event: string, listener: unknown) => {
      if (event === 'message') listeners.add(listener as MessageListener);
    },
    off: (_event: string, listener: MessageListener) => void listeners.delete(listener),
    postMessage: (message: Frame) => void Queue.offerUnsafe(sent, message),
    start: () => void state.started++,
    close: () => void state.closed++,
  } as IpcServerPort;
  return {
    port,
    sent,
    state,
    listenerCount: () => listeners.size,
    receive: (data: Frame) => listeners.forEach((listener) => listener({ data })),
  };
});

const codec = Effect.gen(function* () {
  const serialization = yield* RpcSerialization.RpcSerialization;
  // As a real client does, the payload goes through the serialization's own codec: with the binary one it is bytes.
  const payload = Schema.encodeSync(serialization.codecFor(Schema.Void))(undefined);
  // The answer travels in the serialization's own encoding as well, so it is decoded the way a client does.
  const decodeExit = Schema.decodeUnknownSync(serialization.codecFor(Rpc.exitSchema(AppInfoRpcs.requests.get('AppInfo.get')!)));
  return { ...serialization.makeUnsafe(), decodeExit, request: (id: string) => ({ _tag: 'Request', id, tag: 'AppInfo.get', payload, headers: [] }) };
}).pipe(Effect.provide(layerPortSerialization));

describe('layerIpcServer', () => {
  it.effect('serves a request arriving on a bound port', () =>
    Effect.gen(function* () {
      const parser = yield* codec;
      const handoff = yield* RpcPortHandoff;
      const fake = yield* makeFakePort;

      handoff.bind(fake.port);
      yield* Effect.yieldNow;
      fake.receive(parser.encode(parser.request('1'))!);

      const [reply] = parser.decode(yield* Queue.take(fake.sent)) as ReadonlyArray<unknown>;
      expect(reply).toMatchObject({ _tag: 'Exit', requestId: '1' });
      expect(parser.decodeExit((reply as { exit: unknown }).exit)).toEqual(Exit.succeed(appInfo));
      expect(fake.state.started).toBe(1);
    }).pipe(Effect.provide(layerServer), Effect.scoped),
  );

  it.effect('drops a malformed frame without throwing and keeps serving', () =>
    Effect.gen(function* () {
      const parser = yield* codec;
      const handoff = yield* RpcPortHandoff;
      const fake = yield* makeFakePort;

      handoff.bind(fake.port);
      yield* Effect.yieldNow;
      expect(() => fake.receive(new Uint8Array([0xff, 0xfe, 0xfd, 0x00]))).not.toThrow();
      fake.receive(parser.encode(parser.request('2'))!);

      const [reply] = parser.decode(yield* Queue.take(fake.sent)) as ReadonlyArray<unknown>;
      expect(reply).toMatchObject({ _tag: 'Exit', requestId: '2' });
      expect(parser.decodeExit((reply as { exit: unknown }).exit)).toEqual(Exit.succeed(appInfo));
    }).pipe(Effect.provide(layerServer), Effect.scoped),
  );

  it.effect('closes the previous port when a new one is bound and ignores its late frames', () =>
    Effect.gen(function* () {
      const parser = yield* codec;
      const handoff = yield* RpcPortHandoff;
      const first = yield* makeFakePort;
      const second = yield* makeFakePort;

      handoff.bind(first.port);
      yield* Effect.yieldNow;
      handoff.bind(second.port);
      yield* Effect.yieldNow;

      expect(first.state.closed).toBe(1);
      expect(first.listenerCount()).toBe(0);

      // A frame from the swapped-out port gets no reply; the new port is served.
      first.receive(parser.encode(parser.request('old'))!);
      second.receive(parser.encode(parser.request('new'))!);
      const [reply] = parser.decode(yield* Queue.take(second.sent)) as ReadonlyArray<{ requestId: string }>;
      expect(reply.requestId).toBe('new');
      expect(yield* Queue.size(first.sent)).toBe(0);
    }).pipe(Effect.provide(layerServer), Effect.scoped),
  );
});
