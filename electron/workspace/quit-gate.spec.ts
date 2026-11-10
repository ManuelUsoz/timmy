import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import { QUIT_WAIT_MS, QuitGate, layerQuitGate } from './quit-gate';

/** Lets forked fibers run until they wait on something. */
const settle = Effect.gen(function* () {
  for (let i = 0; i < 10; i++) yield* Effect.yieldNow;
});

describe('QuitGate: Timmy quits once the window saved what it had', () => {
  it.effect('lets Timmy quit at once when no window listens', () =>
    Effect.gen(function* () {
      const gate = yield* QuitGate;
      const quit = yield* Effect.forkChild(gate.beforeQuit);
      yield* settle;
      expect(quit.pollUnsafe()).toBeDefined();
    }).pipe(Effect.provide(layerQuitGate)),
  );

  it.effect('asks the listening window to save and waits for its word', () =>
    Effect.gen(function* () {
      const gate = yield* QuitGate;
      const asked: string[] = [];
      yield* Effect.forkChild(Stream.runForEach(gate.quitting, (event) => Effect.sync(() => void asked.push(event))));
      yield* settle;
      const quit = yield* Effect.forkChild(gate.beforeQuit);
      yield* settle;
      expect(asked).toEqual(['Quitting']);
      expect(quit.pollUnsafe()).toBeUndefined();
      yield* gate.saved;
      yield* Fiber.join(quit);
    }).pipe(Effect.provide(layerQuitGate)),
  );

  it.effect('never holds the quit longer than the cap, even when the window does not answer', () =>
    Effect.gen(function* () {
      const gate = yield* QuitGate;
      yield* Effect.forkChild(Stream.runDrain(gate.quitting));
      yield* settle;
      const quit = yield* Effect.forkChild(gate.beforeQuit);
      yield* settle;
      yield* TestClock.adjust(QUIT_WAIT_MS - 1);
      expect(quit.pollUnsafe()).toBeUndefined();
      yield* TestClock.adjust(1);
      yield* Fiber.join(quit);
    }).pipe(Effect.provide(layerQuitGate)),
  );

  it.effect('stops waiting for a window that went away', () =>
    Effect.gen(function* () {
      const gate = yield* QuitGate;
      const listener = yield* Effect.forkChild(Stream.runDrain(gate.quitting));
      yield* settle;
      yield* Fiber.interrupt(listener);
      const quit = yield* Effect.forkChild(gate.beforeQuit);
      yield* settle;
      expect(quit.pollUnsafe()).toBeDefined();
    }).pipe(Effect.provide(layerQuitGate)),
  );
});
