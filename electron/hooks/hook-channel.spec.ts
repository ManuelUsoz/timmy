import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Option, Stream } from 'effect';
import { TerminalId } from '../../src/shared/terminal/terminal.model';
import type { HookIntegration } from './hook-integration';
import { HookChannel, layerHookChannel } from './hook-channel';
import { layerHookIntegrationsTest } from './hook-integrations';

/** A Provider whose Hook posts `{ say: <signal> }`. */
const fakeIntegration: HookIntegration = {
  provider: 'ClaudeCode',
  isActive: Effect.succeed(false),
  activate: Effect.void,
  deactivate: Effect.void,
  decode: (payload) =>
    typeof payload === 'object' && payload !== null && 'say' in payload && payload.say === 'work' ? Option.some('Working') : Option.none(),
};

const provideChannel = <A, E>(effect: Effect.Effect<A, E, HookChannel>) =>
  effect.pipe(Effect.provide(layerHookChannel), Effect.provide(layerHookIntegrationsTest([fakeIntegration])));

const post = (url: string, body: string, init: RequestInit = {}) =>
  Effect.promise(() => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, ...init }));

const terminal = TerminalId.make('t-1');

describe('HookChannel', () => {
  it.effect('hands the URL of a Terminal to the Provider as a loopback address', () =>
    provideChannel(
      Effect.gen(function* () {
        const channel = yield* HookChannel;
        const url = new URL(channel.urlFor(terminal));
        expect(url.hostname).toBe('127.0.0.1');
        expect(url.pathname).toContain('t-1');
      }),
    ),
  );

  it.effect('turns a post from a Provider Hook into a signal for that Terminal', () =>
    provideChannel(
      Effect.gen(function* () {
        const channel = yield* HookChannel;
        const received = yield* channel.signals.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);
        const response = yield* post(`${channel.urlFor(terminal)}/ClaudeCode`, JSON.stringify({ say: 'work' }));
        expect(response.status).toBe(204);
        expect(Array.from(yield* Fiber.join(received))).toEqual([{ terminalId: terminal, signal: 'Working' }]);
      }),
    ),
  );

  it.effect('refuses a wrong token, other methods, junk and unknown Providers, and says nothing for events that mean nothing', () =>
    provideChannel(
      Effect.gen(function* () {
        const channel = yield* HookChannel;
        const good = channel.urlFor(terminal);
        const origin = new URL(good).origin;
        const received = yield* channel.signals.pipe(Stream.take(1), Stream.runCollect, Effect.forkChild);

        expect((yield* post(`${origin}/hook/wrong-token/t-1/ClaudeCode`, JSON.stringify({ say: 'work' }))).status).toBe(404);
        expect((yield* post(`${good}/ClaudeCode`, JSON.stringify({ say: 'work' }), { method: 'GET', body: undefined })).status).toBe(404);
        expect((yield* post(`${good}/ClaudeCode`, '{ not json')).status).toBe(400);
        expect((yield* post(`${good}/Codex`, JSON.stringify({ say: 'work' }))).status).toBe(404);
        expect((yield* post(`${good}/ClaudeCode`, JSON.stringify({ say: 'nothing' }))).status).toBe(204);

        // None of those became a signal: the next real one is the first the stream sees.
        yield* post(`${good}/ClaudeCode`, JSON.stringify({ say: 'work' }));
        expect(Array.from(yield* Fiber.join(received))).toEqual([{ terminalId: terminal, signal: 'Working' }]);
      }),
    ),
  );

  it.effect('refuses a body that is far too large', () =>
    provideChannel(
      Effect.gen(function* () {
        const channel = yield* HookChannel;
        const response = yield* post(`${channel.urlFor(terminal)}/ClaudeCode`, 'x'.repeat(17 * 1024 * 1024));
        expect(response.status).toBe(413);
      }),
    ),
  );
});
