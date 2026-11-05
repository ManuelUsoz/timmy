import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Context, Effect, Layer, Option, Queue, Schema, Stream } from 'effect';
import type { Cause } from 'effect';
import { Provider } from '../../src/shared/settings/settings.model';
import { TerminalId } from '../../src/shared/terminal/terminal.model';
import type { HookSignal } from '../../src/shared/hooks/hooks.model';
import { HookIntegrations } from './hook-integrations';

/** What a Provider's Hook said about one Terminal. */
export interface HookReport {
  readonly terminalId: TerminalId;
  readonly signal: HookSignal;
}

/**
 * The local channel from a Provider's Hook to main: a loopback HTTP server that lives as long as the app. Every
 * Provider's Hook uses it; the Provider is part of the path, so decoding is the Provider's Integration's job.
 */
export class HookChannel extends Context.Service<HookChannel, {
  /**
   * Where a Terminal's Hook posts, without the Provider (the Hook appends its own). It carries the run's secret, so
   * only a process Timmy gave it to can post.
   */
  readonly urlFor: (terminalId: TerminalId) => string;
  /** What the Hooks reported, in order. */
  readonly signals: Stream.Stream<HookReport>;
}>()('hooks/HookChannel') {}

/**
 * A hook event carries the tool's input and output (a file it read, a command's output), so it can be large; the
 * limit is only there so a runaway sender cannot fill memory.
 */
const MAX_BODY = 16 * 1024 * 1024;

const decodeProvider = Schema.decodeUnknownOption(Provider);
const decodeTerminalId = Schema.decodeUnknownOption(TerminalId);

const reply = (response: ServerResponse, status: number): void => {
  response.writeHead(status).end();
};

/** The body as text, or `undefined` once it is over the limit. */
const readBody = (request: IncomingMessage): Promise<string | undefined> =>
  new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // Past the limit the rest is read and dropped, so the sender still gets its answer.
      if (size > MAX_BODY) chunks.length = 0;
      else chunks.push(chunk);
    });
    request.on('end', () => resolve(size > MAX_BODY ? undefined : Buffer.concat(chunks).toString('utf8')));
    request.on('error', () => resolve(undefined));
  });

export const layerHookChannel: Layer.Layer<HookChannel, never, HookIntegrations> = Layer.effect(
  HookChannel,
  Effect.gen(function* () {
    const integrations = yield* HookIntegrations;
    const reports = yield* Queue.unbounded<HookReport, Cause.Done>();
    const token = crypto.randomUUID();

    const handle = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
      // /hook/<token>/<terminalId>/<Provider>
      const [, root, given, id, name] = (request.url ?? '').split('?')[0]!.split('/');
      const provider = decodeProvider(name);
      const terminalId = decodeTerminalId(id);
      if (request.method !== 'POST' || root !== 'hook' || given !== token || Option.isNone(provider) || Option.isNone(terminalId)) {
        return reply(response, 404);
      }
      const integration = integrations.get(provider.value);
      if (Option.isNone(integration)) return reply(response, 404);
      const body = await readBody(request);
      if (body === undefined) return reply(response, 413);
      let payload: unknown;
      try {
        payload = JSON.parse(body);
      } catch {
        return reply(response, 400);
      }
      const signal = integration.value.decode(payload);
      if (Option.isSome(signal)) Queue.offerUnsafe(reports, { terminalId: terminalId.value, signal: signal.value });
      reply(response, 204);
    };

    const server = yield* Effect.acquireRelease(
      Effect.promise(
        () =>
          new Promise<ReturnType<typeof createServer>>((resolve) => {
            const created = createServer((request, response) => {
              handle(request, response).catch(() => reply(response, 500));
            });
            created.listen(0, '127.0.0.1', () => resolve(created));
          }),
      ),
      (created) => Effect.promise(() => new Promise<void>((resolve) => created.close(() => resolve()))),
    );
    const { port } = server.address() as AddressInfo;

    return HookChannel.of({
      urlFor: (terminalId) => `http://127.0.0.1:${port}/hook/${token}/${terminalId}`,
      signals: Stream.fromQueue(reports),
    });
  }),
);

/** A channel nobody posts to, for tests that are not about Hooks. */
export const quietHookChannel: typeof HookChannel.Service = {
  urlFor: (terminalId) => `http://127.0.0.1:0/hook/test/${terminalId}`,
  signals: Stream.empty,
};

/** A channel with no server, for tests: `emit` plays the part of a Provider's Hook posting. */
export const makeHookChannelTest = Effect.fnUntraced(function* () {
  const reports = yield* Queue.unbounded<HookReport, Cause.Done>();
  return {
    channel: HookChannel.of({ ...quietHookChannel, signals: Stream.fromQueue(reports) }),
    emit: (report: HookReport): Effect.Effect<void> => Queue.offer(reports, report).pipe(Effect.asVoid),
  };
});
