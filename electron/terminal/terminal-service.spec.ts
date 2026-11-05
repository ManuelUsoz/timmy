import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Stream } from 'effect';
import type { Scope } from 'effect';
import { TestClock } from 'effect/testing';
import type { Provider } from '../../src/shared/settings/settings.model';
import type { NotificationEvent } from '../../src/shared/notification/notification.model';
import type { TerminalId } from '../../src/shared/terminal/terminal.model';
import { NotificationBus } from '../notification/notification-bus';
import { TerminalId as TerminalIdSchema } from '../../src/shared/terminal/terminal.model';
import type { HookSignal } from '../../src/shared/hooks/hooks.model';
import { makeHookChannelTest } from '../hooks/hook-channel';
import { HOOK_STALE_AFTER_MS, IDLE_AFTER_MS, TerminalService, layerTerminalServiceTest, type PtyProcess } from './terminal-service';

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

/** Collects what a Subscriber hears from now on; `heard` lets the pending fibers run first. */
const listen = Effect.gen(function* () {
  const bus = yield* NotificationBus;
  const events: NotificationEvent[] = [];
  yield* bus.subscribe.pipe(Stream.runForEach((event) => Effect.sync(() => void events.push(event))), Effect.forkScoped);
  yield* Effect.yieldNow;
  return {
    heard: Effect.gen(function* () {
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      return [...events];
    }),
  };
});

const notified = (terminalId: TerminalId, type: 'Idle' | 'Working' | 'Waiting' | 'Done' | 'Error'): NotificationEvent => ({
  _tag: 'Notified',
  notification: { source: { _tag: 'Terminal', terminalId }, type, seen: false },
});

describe('TerminalService notifications', () => {
  const withPty = <A, E>(
    use: (pty: ReturnType<typeof makePty>, service: typeof TerminalService.Service, subscriber: Effect.Success<typeof listen>) => Effect.Effect<A, E, NotificationBus | Scope.Scope>,
  ) => {
    const pty = makePty();
    return Effect.gen(function* () {
      const subscriber = yield* listen;
      return yield* use(pty, yield* TerminalService, subscriber);
    }).pipe(Effect.scoped, Effect.provide(layerTerminalServiceTest({ spawn: () => Effect.succeed(pty.process) })));
  };

  it.effect('a created Terminal is Idle, and then Working once its process is live', () =>
    withPty((_pty, service, subscriber) =>
      Effect.gen(function* () {
        const id = yield* service.create('C:/project');
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working')]);
      }),
    ),
  );

  it.effect('a clean exit is Done', () =>
    withPty((pty, service, subscriber) =>
      Effect.gen(function* () {
        const id = yield* service.create('C:/project');
        pty.exit(0);
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Done')]);
      }),
    ),
  );

  it.effect('any other exit code is an Error', () =>
    withPty((pty, service, subscriber) =>
      Effect.gen(function* () {
        const id = yield* service.create('C:/project');
        pty.exit(3);
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Error')]);
      }),
    ),
  );

  it.effect('a Subscriber that connects late hears the latest status of every open Terminal', () =>
    withPty((pty, service) =>
      Effect.gen(function* () {
        const id = yield* service.create('C:/project');
        pty.exit(0);
        yield* Effect.yieldNow;
        const late = yield* listen;
        expect(yield* late.heard).toEqual([notified(id, 'Done')]);
      }),
    ),
  );

  it.effect('closing a Terminal retracts its Source, and the process ending afterwards does not bring it back', () =>
    withPty((pty, service, subscriber) =>
      Effect.gen(function* () {
        const id = yield* service.create('C:/project');
        yield* service.close(id);
        pty.exit(0);
        expect(yield* subscriber.heard).toEqual([
          notified(id, 'Idle'),
          notified(id, 'Working'),
          { _tag: 'Retracted', source: { _tag: 'Terminal', terminalId: id } },
        ]);
        const late = yield* listen;
        expect(yield* late.heard).toEqual([]);
      }),
    ),
  );
});

describe('TerminalService notifications from a Hook', () => {
  /** A Terminal whose Provider has a Hook, with a Subscriber listening: `report` is the Hook posting to the local channel. */
  const withHookedTerminal = <A, E>(
    use: (ctx: {
      readonly pty: ReturnType<typeof makePty>;
      readonly id: TerminalId;
      readonly report: (signal: HookSignal) => Effect.Effect<void>;
      readonly subscriber: Effect.Success<typeof listen>;
    }) => Effect.Effect<A, E, NotificationBus | Scope.Scope>,
  ) =>
    Effect.gen(function* () {
      const pty = makePty();
      const { channel, emit } = yield* makeHookChannelTest();
      return yield* Effect.gen(function* () {
        const subscriber = yield* listen;
        const id = yield* (yield* TerminalService).create('C:/project', 'ClaudeCode');
        return yield* use({ pty, id, subscriber, report: (signal) => emit({ terminalId: id, signal }) });
      }).pipe(Effect.scoped, Effect.provide(layerTerminalServiceTest({ spawn: () => Effect.succeed(pty.process) }, channel)));
    });

  it.effect('a Hook that reports Waiting publishes Waiting', () =>
    withHookedTerminal(({ id, report, subscriber }) =>
      Effect.gen(function* () {
        yield* report('Waiting');
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Waiting')]);
      }),
    ),
  );

  it.effect('the end of the agent\'s turn publishes Done, and its next prompt takes the Terminal back to Working', () =>
    withHookedTerminal(({ id, report, subscriber }) =>
      Effect.gen(function* () {
        yield* report('Working');
        yield* report('Done');
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Done')]);
        yield* report('Working');
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Done'), notified(id, 'Working')]);
      }),
    ),
  );

  it.effect('a Hook that repeats the status the Terminal is already in publishes nothing new', () =>
    withHookedTerminal(({ id, report, subscriber }) =>
      Effect.gen(function* () {
        yield* report('Waiting');
        yield* report('Waiting');
        yield* report('Working');
        yield* report('Working');
        yield* report('Working');
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Waiting'), notified(id, 'Working')]);
      }),
    ),
  );

  it.effect('when the Hook\'s session ends, the Terminal falls back to what its process and output say', () =>
    withHookedTerminal(({ pty, id, report, subscriber }) =>
      Effect.gen(function* () {
        yield* report('Waiting');
        yield* report('Ended');
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Waiting'), notified(id, 'Working')]);
        pty.emit('\x07');
        expect(yield* subscriber.heard).toEqual([
          notified(id, 'Idle'),
          notified(id, 'Working'),
          notified(id, 'Waiting'),
          notified(id, 'Working'),
          notified(id, 'Waiting'),
        ]);
      }),
    ),
  );

  it.effect('the output tap does not count while the Hook is reporting', () =>
    withHookedTerminal(({ pty, id, report, subscriber }) =>
      Effect.gen(function* () {
        yield* report('Done');
        // The report travels through the channel on its own fiber: let it land before the output arrives.
        yield* subscriber.heard;
        pty.emit('prompt redraw\x07');
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Done')]);
      }),
    ),
  );

  it.effect('a process that exits after the Hook reported keeps the exit\'s status, and nothing follows it', () =>
    withHookedTerminal(({ pty, id, report, subscriber }) =>
      Effect.gen(function* () {
        yield* report('Waiting');
        yield* subscriber.heard;
        pty.exit(3);
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Waiting'), notified(id, 'Error')]);
        yield* TestClock.adjust(HOOK_STALE_AFTER_MS * 2);
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Waiting'), notified(id, 'Error')]);
      }),
    ),
  );
});

describe('TerminalService notifications from the output tap', () => {
  const withPlainTerminal = <A, E>(
    use: (ctx: {
      readonly pty: ReturnType<typeof makePty>;
      readonly service: typeof TerminalService.Service;
      readonly id: TerminalId;
      readonly subscriber: Effect.Success<typeof listen>;
    }) => Effect.Effect<A, E, NotificationBus | Scope.Scope>,
  ) =>
    Effect.gen(function* () {
      const pty = makePty();
      return yield* Effect.gen(function* () {
        const subscriber = yield* listen;
        const service = yield* TerminalService;
        const id = yield* service.create('C:/project');
        return yield* use({ pty, service, id, subscriber });
      }).pipe(Effect.scoped, Effect.provide(layerTerminalServiceTest({ spawn: () => Effect.succeed(pty.process) })));
    });

  it.effect('a bell puts a Terminal without a Hook in Waiting, and focusing it takes it back to Working', () =>
    withPlainTerminal(({ pty, service, id, subscriber }) =>
      Effect.gen(function* () {
        pty.emit('build finished\x07');
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Waiting')]);
        yield* service.focus(id);
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Waiting'), notified(id, 'Working')]);
      }),
    ),
  );

  it.effect('output going quiet never publishes a status', () =>
    withPlainTerminal(({ pty, id, subscriber }) =>
      Effect.gen(function* () {
        pty.emit('building…');
        yield* TestClock.adjust(IDLE_AFTER_MS * 5);
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working')]);
      }),
    ),
  );

  it.effect('a bell before the process exits does not outlive it: the exit\'s status is the last', () =>
    withPlainTerminal(({ pty, id, subscriber }) =>
      Effect.gen(function* () {
        pty.emit('\x07');
        pty.exit(0);
        expect(yield* subscriber.heard).toEqual([notified(id, 'Idle'), notified(id, 'Working'), notified(id, 'Waiting'), notified(id, 'Done')]);
      }),
    ),
  );
});

describe('TerminalService with a Hook', () => {
  /** A Terminal whose Provider has a Hook: `report` is the Hook posting to the local channel. */
  const withHook = <A, E>(use: (ctx: { pty: ReturnType<typeof makePty>; service: typeof TerminalService.Service; id: TerminalId; report: (signal: HookSignal, to?: TerminalId) => Effect.Effect<void>; spawned: Array<{ cwd: string; env: Readonly<Record<string, string>> | undefined }> }) => Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      const pty = makePty();
      const spawned: Array<{ cwd: string; env: Readonly<Record<string, string>> | undefined }> = [];
      const { channel, emit } = yield* makeHookChannelTest();
      return yield* Effect.gen(function* () {
        const service = yield* TerminalService;
        const id = yield* service.create('C:/project', 'ClaudeCode');
        return yield* use({ pty, service, id, spawned, report: (signal, to) => emit({ terminalId: to ?? id, signal }) });
      }).pipe(
        Effect.provide(
          layerTerminalServiceTest(
            {
              spawn: (cwd, env) => {
                spawned.push({ cwd, env });
                return Effect.succeed(pty.process);
              },
            },
            channel,
          ),
        ),
      );
    });

  const activityOf = (service: typeof TerminalService.Service, id: TerminalId) =>
    Effect.gen(function* () {
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;
      const [snapshot] = yield* service.activity.pipe(Stream.take(1), Stream.runCollect);
      return snapshot?.find((entry) => entry.terminalId === id)?.activity;
    });

  it.effect('every Terminal starts with the id and the Hook URL in its environment, which is what activates the Hook', () =>
    withHook(({ id, spawned }) =>
      Effect.sync(() => {
        expect(spawned).toHaveLength(1);
        expect(spawned[0]!.env).toEqual({ TIMMY_TERMINAL_ID: id, TIMMY_HOOK_URL: `http://127.0.0.1:0/hook/test/${id}` });
      }),
    ),
  );

  it.effect('follows the Hook: Working is Active, Waiting needs attention, Done is Idle', () =>
    withHook(({ service, id, report }) =>
      Effect.gen(function* () {
        yield* report('Working');
        expect(yield* activityOf(service, id)).toBe('Active');
        yield* report('Waiting');
        expect(yield* activityOf(service, id)).toBe('NeedsAttention');
        yield* report('Working');
        expect(yield* activityOf(service, id)).toBe('Active');
        yield* report('Done');
        expect(yield* activityOf(service, id)).toBe('Idle');
      }),
    ),
  );

  it.effect('replaces the output: it stays Done while the CLI prints, and Active with no quiet timeout while Working', () =>
    withHook(({ pty, service, id, report }) =>
      Effect.gen(function* () {
        yield* report('Done');
        pty.emit('prompt redraw\x07');
        expect(yield* activityOf(service, id)).toBe('Idle');
        yield* report('Working');
        yield* TestClock.adjust(IDLE_AFTER_MS * 5);
        expect(yield* activityOf(service, id)).toBe('Active');
      }),
    ),
  );

  it.effect('stops believing a Working Hook that has gone silent, as after an interrupt that sends no Stop', () =>
    withHook(({ pty, service, id, report }) =>
      Effect.gen(function* () {
        yield* report('Working');
        yield* TestClock.adjust(HOOK_STALE_AFTER_MS - 1);
        expect(yield* activityOf(service, id)).toBe('Active');
        // Anything the CLI draws is a sign of life and starts the wait again.
        pty.emit('spinner');
        yield* activityOf(service, id);
        yield* TestClock.adjust(HOOK_STALE_AFTER_MS - 1);
        expect(yield* activityOf(service, id)).toBe('Active');
        yield* TestClock.adjust(1);
        expect(yield* activityOf(service, id)).toBe('Idle');
      }),
    ),
  );

  it.effect('falls back to the output when the session ends', () =>
    withHook(({ pty, service, id, report }) =>
      Effect.gen(function* () {
        yield* report('Working');
        yield* report('Ended');
        expect(yield* activityOf(service, id)).toBe('Idle');
        pty.emit('shell output');
        expect(yield* activityOf(service, id)).toBe('Active');
      }),
    ),
  );

  it.effect('ignores a report for a Terminal that does not exist', () =>
    withHook(({ service, id, report }) =>
      Effect.gen(function* () {
        yield* report('Working', TerminalIdSchema.make('someone-else'));
        expect(yield* activityOf(service, id)).toBe('Idle');
      }),
    ),
  );
});
