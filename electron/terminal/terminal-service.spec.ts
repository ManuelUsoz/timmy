import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Stream } from 'effect';
import { TestClock } from 'effect/testing';
import type { Provider } from '../../src/shared/settings/settings.model';
import type { TerminalId } from '../../src/shared/terminal/terminal.model';
import { IDLE_AFTER_MS, TerminalService, layerTerminalServiceTest, type PtyProcess } from './terminal-service';

const makePty = () => {
  let dataListener: ((data: string) => void) | undefined;
  let exitListener: ((event: { exitCode: number }) => void) | undefined;
  const writes: string[] = [];
  let killed = false;
  const process: PtyProcess = {
    onData: (listener) => {
      dataListener = listener;
      return { dispose: () => undefined };
    },
    onExit: (listener) => {
      exitListener = listener;
      return { dispose: () => undefined };
    },
    write: (data) => writes.push(data),
    resize: () => undefined,
    kill: () => {
      killed = true;
    },
  };
  return {
    process,
    writes,
    get killed() {
      return killed;
    },
    emit(data: string) {
      dataListener?.(data);
    },
    exit(exitCode: number) {
      exitListener?.({ exitCode });
    },
  };
};

describe('TerminalService', () => {
  it.effect('creates a PTY in the requested folder and streams output', () => {
    const pty = makePty();
    return Effect.gen(function* () {
      const service = yield* TerminalService;
      const id = yield* service.create('C:/project');
      pty.emit('hello');
      const event = yield* service.output(id).pipe(Stream.take(1), Stream.runCollect);
      expect(event[0]).toEqual({ _tag: 'Data', data: 'hello' });
    }).pipe(Effect.provide(layerTerminalServiceTest({ spawn: () => Effect.succeed(pty.process) })));
  });

  it.effect('writes and closes the process without storing anything', () => {
    const pty = makePty();
    return Effect.gen(function* () {
      const service = yield* TerminalService;
      const id = yield* service.create('C:/project');
      yield* service.write(id, 'dir\r');
      yield* service.close(id);
      expect(pty.writes).toEqual(['dir\r']);
      expect(pty.killed).toBe(true);
    }).pipe(Effect.provide(layerTerminalServiceTest({ spawn: () => Effect.succeed(pty.process) })));
  });

  it.effect('a Provider types its CLI command into the shell, so exiting the CLI leaves the shell open', () => {
    const pty = makePty();
    return Effect.gen(function* () {
      const service = yield* TerminalService;
      yield* service.create('C:/project', 'ClaudeCode');
      expect(pty.writes).toEqual(['claude\r']);
      expect(pty.killed).toBe(false);
    }).pipe(Effect.provide(layerTerminalServiceTest({ spawn: () => Effect.succeed(pty.process) })));
  });

  it.effect('starts every Provider with its own CLI, and a plain shell with nothing typed', () =>
    Effect.gen(function* () {
      const typed = (provider?: Provider) => {
        const pty = makePty();
        return Effect.gen(function* () {
          yield* (yield* TerminalService).create('C:/project', provider);
          return pty.writes;
        }).pipe(Effect.provide(layerTerminalServiceTest({ spawn: () => Effect.succeed(pty.process) })));
      };
      expect(yield* typed()).toEqual([]);
      expect(yield* typed('OpenCode')).toEqual(['opencode\r']);
      expect(yield* typed('Codex')).toEqual(['codex\r']);
    }),
  );

  it.effect('delivers the output and the exit code of a process that ends, then completes the stream', () => {
    const pty = makePty();
    return Effect.gen(function* () {
      const service = yield* TerminalService;
      const id = yield* service.create('C:/project');
      pty.emit('bye');
      pty.exit(3);
      const events = yield* service.output(id).pipe(Stream.runCollect);
      expect(events).toEqual([
        { _tag: 'Data', data: 'bye' },
        { _tag: 'Exit', exitCode: 3 },
      ]);
    }).pipe(Effect.provide(layerTerminalServiceTest({ spawn: () => Effect.succeed(pty.process) })));
  });
});

describe('TerminalService activity', () => {
  const withPty = <A, E>(use: (pty: ReturnType<typeof makePty>, service: typeof TerminalService.Service, id: TerminalId) => Effect.Effect<A, E>) => {
    const pty = makePty();
    return Effect.gen(function* () {
      const service = yield* TerminalService;
      const id = yield* service.create('C:/project');
      return yield* use(pty, service, id);
    }).pipe(Effect.provide(layerTerminalServiceTest({ spawn: () => Effect.succeed(pty.process) })));
  };

  /** Lets the fibers that read the signals run, then reads the activity of the Terminal. */
  const activityOf = (service: typeof TerminalService.Service, id: TerminalId) =>
    Effect.gen(function* () {
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const [snapshot] = yield* service.activity.pipe(Stream.take(1), Stream.runCollect);
      return snapshot?.find((entry) => entry.terminalId === id)?.activity;
    });

  it.effect('a new Terminal is Idle', () =>
    withPty((_pty, service, id) => Effect.map(activityOf(service, id), (activity) => expect(activity).toBe('Idle'))),
  );

  it.effect('is Active when it prints and Idle after a quiet period', () =>
    withPty((pty, service, id) =>
      Effect.gen(function* () {
        pty.emit('building…');
        expect(yield* activityOf(service, id)).toBe('Active');
        yield* TestClock.adjust(IDLE_AFTER_MS - 1);
        expect(yield* activityOf(service, id)).toBe('Active');
        yield* TestClock.adjust(1);
        expect(yield* activityOf(service, id)).toBe('Idle');
      }),
    ),
  );

  it.effect('more output keeps it Active past the first quiet period', () =>
    withPty((pty, service, id) =>
      Effect.gen(function* () {
        pty.emit('a');
        yield* activityOf(service, id);
        yield* TestClock.adjust(IDLE_AFTER_MS - 1);
        pty.emit('b');
        yield* activityOf(service, id);
        yield* TestClock.adjust(IDLE_AFTER_MS - 1);
        expect(yield* activityOf(service, id)).toBe('Active');
        yield* TestClock.adjust(1);
        expect(yield* activityOf(service, id)).toBe('Idle');
      }),
    ),
  );

  it.effect('a bell needs attention, through the quiet period, until the Terminal is focused', () =>
    withPty((pty, service, id) =>
      Effect.gen(function* () {
        pty.emit('\x07');
        expect(yield* activityOf(service, id)).toBe('NeedsAttention');
        yield* TestClock.adjust(IDLE_AFTER_MS);
        expect(yield* activityOf(service, id)).toBe('NeedsAttention');
        yield* service.focus(id);
        expect(yield* activityOf(service, id)).toBe('Idle');
      }),
    ),
  );

  it.effect('an OSC notification needs attention too', () =>
    withPty((pty, service, id) =>
      Effect.gen(function* () {
        pty.emit('\x1b]9;Build finished\x07');
        expect(yield* activityOf(service, id)).toBe('NeedsAttention');
      }),
    ),
  );

  it.effect('a process that exits is Idle, and the activity of a closed Terminal is gone', () =>
    withPty((pty, service, id) =>
      Effect.gen(function* () {
        pty.emit('\x07');
        pty.exit(0);
        expect(yield* activityOf(service, id)).toBe('Idle');
        yield* service.close(id);
        expect(yield* activityOf(service, id)).toBeUndefined();
      }),
    ),
  );

  it.effect('a Terminal closed with signals still queued does not come back in the activity', () =>
    withPty((pty, service, id) =>
      Effect.gen(function* () {
        pty.emit('');
        yield* service.close(id);
        expect(yield* activityOf(service, id)).toBeUndefined();
      }),
    ),
  );

  it.effect('publishes every change, starting from the current activity', () =>
    withPty((pty, service, id) =>
      Effect.gen(function* () {
        const changes = yield* service.activity.pipe(
          Stream.map((snapshot) => snapshot.find((entry) => entry.terminalId === id)?.activity),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkChild,
        );
        yield* Effect.yieldNow;
        pty.emit('x');
        yield* Effect.yieldNow;
        yield* Effect.yieldNow;
        yield* TestClock.adjust(IDLE_AFTER_MS);
        expect(Array.from(yield* Fiber.join(changes))).toEqual(['Idle', 'Active', 'Idle']);
      }),
    ),
  );

  it.effect('focusing an unknown Terminal fails with NotFound', () =>
    withPty((_pty, service) =>
      Effect.gen(function* () {
        const error = yield* service.focus('nope' as TerminalId).pipe(Effect.flip);
        expect(error.reason).toBe('NotFound');
      }),
    ),
  );
});
