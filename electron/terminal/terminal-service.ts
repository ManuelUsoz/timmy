import { Context, Deferred, Duration, Effect, Fiber, Layer, Option, Queue, Ref, Scope, Semaphore, Stream, SubscriptionRef } from 'effect';
import type { Cause } from 'effect';
import * as pty from 'node-pty';
import type { IPty, IWindowsPtyForkOptions } from 'node-pty';
import type { Provider } from '../../src/shared/settings/settings.model';
import type { TerminalStatus } from '../../src/shared/notification/notification.model';
import { TerminalError } from '../../src/shared/terminal/terminal-error.model';
import type { TerminalActivity, TerminalActivityEntry, TerminalEvent, TerminalId } from '../../src/shared/terminal/terminal.model';
import { TerminalId as TerminalIdSchema } from '../../src/shared/terminal/terminal.model';
import { HookChannel, quietHookChannel } from '../hooks/hook-channel';
import { HookConstants, type HookSignal } from '../../src/shared/hooks/hooks.model';
import { NotificationBus, layerNotificationBus } from '../notification/notification-bus';
import { makeOutputTap } from './output-tap';
import { providerCommand } from './provider-command';
import { activityOf, initialActivity, nextActivity, statusOf, type ActivityEvent } from './terminal-activity';

export interface PtyProcess {
  readonly onData: (listener: (data: string) => void) => { dispose: () => void };
  readonly onExit: (listener: (event: { exitCode: number }) => void) => { dispose: () => void };
  readonly write: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly kill: () => void;
}

export class PtyHost extends Context.Service<PtyHost, {
  /** `env` is added to the environment the shell inherits. */
  readonly spawn: (cwd: string, env?: Readonly<Record<string, string>>) => Effect.Effect<PtyProcess, TerminalError>;
}>()('terminal/PtyHost') {}

/** How long a Terminal must be quiet before it counts as Idle instead of Active. */
export const IDLE_AFTER_MS = 2000;

/**
 * How long a Terminal whose Hook says Working may print nothing before the Hook is not believed. A working agent keeps
 * drawing (a spinner, its output); silence means it stopped without saying so, as when the user interrupts it.
 */
export const HOOK_STALE_AFTER_MS = 30_000;

type Terminal = {
  readonly process: PtyProcess;
  readonly events: Queue.Queue<TerminalEvent, Cause.Done>;
  /** What happens to the Terminal's activity: the tap's signals, the user focusing it, the process ending. */
  readonly activity: Queue.Queue<ActivityEvent, Cause.Done>;
  /** Folds `activity` into what is published; stopped on close so it cannot publish for a Terminal that is gone. */
  readonly tracker: Fiber.Fiber<void>;
};

const shellCandidates = (): ReadonlyArray<string> =>
  process.platform === 'win32' ? ['pwsh.exe', 'powershell.exe'] : [process.env['SHELL'] ?? '/bin/sh'];

const nativePtyHost: Layer.Layer<PtyHost> = Layer.succeed(PtyHost, {
  spawn: Effect.fn('PtyHost.spawn')(function* (cwd, env) {
    let lastError: unknown;
    for (const shell of shellCandidates()) {
      try {
        const options: IWindowsPtyForkOptions = { name: 'xterm-256color', cols: 120, rows: 34, cwd, env: { ...process.env, ...env } };
        return pty.spawn(shell, [], options) as unknown as PtyProcess;
      } catch (error) {
        lastError = error;
      }
    }
    return yield* new TerminalError({ reason: 'PtyUnavailable', detail: String(lastError ?? 'No shell is available') });
  }),
});

export class TerminalService extends Context.Service<TerminalService, {
  /**
   * With a Provider, its CLI command is typed into the new shell: the shell outlives the CLI. With a `terminalId` (a
   * saved Terminal being started, ADR 0011) the Terminal keeps that identity; it fails if a live Terminal has it.
   */
  readonly create: (cwd: string, provider?: Provider, terminalId?: TerminalId) => Effect.Effect<TerminalId, TerminalError>;
  readonly output: (id: TerminalId) => Stream.Stream<TerminalEvent, TerminalError>;
  /** The activity of every Terminal: the current one first, then a new snapshot at each change. */
  readonly activity: Stream.Stream<ReadonlyArray<TerminalActivityEntry>>;
  /** The user is on the Terminal: a bell or notification it raised has been seen. */
  readonly focus: (id: TerminalId) => Effect.Effect<void, TerminalError>;
  readonly write: (id: TerminalId, data: string) => Effect.Effect<void, TerminalError>;
  readonly resize: (id: TerminalId, cols: number, rows: number) => Effect.Effect<void, TerminalError>;
  readonly close: (id: TerminalId) => Effect.Effect<void, TerminalError>;
}>()('terminal/TerminalService') {}

/** What a Terminal's process ended with: a clean exit is Done, any other code is an Error. */
export const statusOfExit = (exitCode: number): TerminalStatus => (exitCode === 0 ? 'Done' : 'Error');

/** What a Hook's report does to a Terminal's activity. */
const hookEvents: Readonly<Record<HookSignal, ActivityEvent>> = {
  Working: 'HookWorking',
  Waiting: 'HookWaiting',
  Done: 'HookDone',
  Ended: 'HookEnded',
};

const layerTerminalServiceCore = Layer.effect(
  TerminalService,
  Effect.gen(function* () {
    const host = yield* PtyHost;
    const bus = yield* NotificationBus;
    const hooks = yield* HookChannel;
    const scope = yield* Scope.Scope;
    const terminals = yield* Ref.make<ReadonlyMap<TerminalId, Terminal>>(new Map());
    const activities = yield* SubscriptionRef.make<ReadonlyMap<TerminalId, TerminalActivity>>(new Map());

    const publish = (id: TerminalId, activity: TerminalActivity | undefined): Effect.Effect<void> =>
      SubscriptionRef.update(activities, (all) => {
        if (all.get(id) === activity) return all;
        const next = new Map(all);
        if (activity === undefined) next.delete(id);
        else next.set(id, activity);
        return next;
      });

    /**
     * Folds a Terminal's activity events into its activity. While it is busy, or its Hook says Working, the wait for the
     * next event is bounded: running out means it went quiet, or that the Hook went stale. Ends when the queue does (the process exited or the Terminal was closed).
     */
    const trackActivity = Effect.fnUntraced(function* (
      id: TerminalId,
      events: Queue.Queue<ActivityEvent, Cause.Done>,
      exitStatus: Deferred.Deferred<TerminalStatus>,
    ) {
      let state = initialActivity;
      // A live Terminal starts out Working (see `create`).
      let status: TerminalStatus = 'Working';
      while (true) {
        const hookWorking = state.hook === 'Working';
        const next =
          state.busy || hookWorking
            ? yield* Queue.take(events).pipe(Effect.timeoutOption(Duration.millis(hookWorking ? HOOK_STALE_AFTER_MS : IDLE_AFTER_MS)))
            : Option.some(yield* Queue.take(events));
        const event = Option.getOrElse(next, (): ActivityEvent => (hookWorking ? 'HookEnded' : 'Quiet'));
        state = nextActivity(state, event);
        yield* publish(id, activityOf(state));
        // The process ending is the last thing that happens to a Terminal. It is published from here, in the order the
        // events arrived, so a bell or a report still queued behind it cannot publish after the exit's status.
        if (event === 'Exited') return yield* Deferred.await(exitStatus).pipe(Effect.flatMap((exited) => enter(id, exited)));
        const nextStatus = statusOf(state);
        if (nextStatus !== status) {
          status = nextStatus;
          yield* enter(id, status);
        }
      }
    });

    // A Terminal's status changes and its closing never interleave: a process that ends after the Terminal was closed
    // finds it gone and publishes nothing, so a retracted Source cannot come back.
    const transitions = yield* Semaphore.make(1);

    const enter = (id: TerminalId, type: TerminalStatus): Effect.Effect<void> =>
      transitions.withPermits(1)(
        Effect.gen(function* () {
          if ((yield* Ref.get(terminals)).has(id)) yield* bus.publish({ source: { _tag: 'Terminal', terminalId: id }, type });
        }),
      );

    const get = Effect.fn('TerminalService.get')(function* (id: TerminalId) {
      const terminal = (yield* Ref.get(terminals)).get(id);
      if (terminal === undefined) return yield* new TerminalError({ reason: 'NotFound', detail: `Terminal ${id} was not found` });
      return terminal;
    });

    const closeProcess = (terminal: Terminal): Effect.Effect<void> =>
      Effect.sync(() => {
        try {
          terminal.process.kill();
        } catch {
          // The process may already have exited.
        }
      });

    // A report for a Terminal that is gone (or never existed) is dropped.
    yield* hooks.signals.pipe(
      Stream.runForEach(({ terminalId, signal }) =>
        Ref.get(terminals).pipe(
          Effect.flatMap((all) => {
            const terminal = all.get(terminalId);
            return terminal === undefined ? Effect.void : Queue.offer(terminal.activity, hookEvents[signal]);
          }),
        ),
      ),
      Effect.forkIn(scope),
    );

    yield* Effect.addFinalizer(() =>
      Ref.get(terminals).pipe(
        Effect.flatMap((all) => Effect.forEach(all.values(), closeProcess, { discard: true })),
      ),
    );

    return TerminalService.of({
      create: Effect.fn('TerminalService.create')(function* (cwd, provider, terminalId) {
        if (cwd.trim() === '') return yield* new TerminalError({ reason: 'InvalidCwd', detail: 'A terminal needs a project folder' });
        const id = terminalId ?? TerminalIdSchema.make(crypto.randomUUID());
        if ((yield* Ref.get(terminals)).has(id)) return yield* new TerminalError({ reason: 'AlreadyExists', detail: `Terminal ${id} is already running` });
        // Setting these is what turns a Provider's Hook on for this Terminal (ADR 0009).
        const process = yield* host.spawn(cwd, { [HookConstants.terminalIdEnv]: id, [HookConstants.urlEnv]: hooks.urlFor(id) });
        const events = yield* Queue.unbounded<TerminalEvent, Cause.Done>();
        const activity = yield* Queue.unbounded<ActivityEvent, Cause.Done>();
        // The tap reads a copy of the output: what the renderer receives is not changed by it.
        const tap = makeOutputTap();
        process.onData((data) =>
          // eslint-disable-next-line no-restricted-properties -- node-pty callback is a native edge; the effect only offers to queues
          Effect.runFork(
            Queue.offer(events, { _tag: 'Data', data }).pipe(Effect.andThen(Queue.offerAll(activity, tap.scan(data)))),
          ),
        );
        yield* publish(id, 'Idle');
        const exitStatus = yield* Deferred.make<TerminalStatus>();
        const tracker = yield* trackActivity(id, activity, exitStatus).pipe(Effect.ignore, Effect.forkIn(scope));
        const terminal = { process, events, activity, tracker };
        yield* Ref.update(terminals, (all) => new Map(all).set(id, terminal));
        process.onExit(({ exitCode }) => {
          // The terminal stays listed until it is closed, so a screen opened after the exit still reads it.
          // eslint-disable-next-line no-restricted-properties -- node-pty callback is a native edge; the effect only offers to queues
          Effect.runFork(
            Deferred.succeed(exitStatus, statusOfExit(exitCode)).pipe(
              Effect.andThen(Queue.offer(events, { _tag: 'Exit', exitCode })),
              Effect.andThen(Queue.end(events)),
              Effect.andThen(Queue.offer(activity, 'Exited')),
              Effect.andThen(Queue.end(activity)),
            ),
          );
        });
        // Created, the Terminal is Idle; its process is already live, so it is Working right after.
        yield* enter(id, 'Idle');
        yield* enter(id, 'Working');
        if (provider !== undefined) yield* Effect.sync(() => process.write(`${providerCommand(provider)}\r`));
        return id;
      }),
      output: (id) => Stream.unwrap(get(id).pipe(Effect.map((terminal) => Stream.fromQueue(terminal.events)))), 
      activity: SubscriptionRef.changes(activities).pipe(
        Stream.map((all) => Array.from(all, ([terminalId, activity]) => ({ terminalId, activity }))),
      ),
      focus: Effect.fn('TerminalService.focus')(function* (id) {
        const terminal = yield* get(id);
        yield* Queue.offer(terminal.activity, 'Focused');
      }),
      write: Effect.fn('TerminalService.write')(function* (id, data) {
        const terminal = yield* get(id);
        yield* Effect.sync(() => terminal.process.write(data));
      }),
      resize: Effect.fn('TerminalService.resize')(function* (id, cols, rows) {
        const terminal = yield* get(id);
        if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1) {
          return yield* new TerminalError({ reason: 'InvalidDimensions', detail: 'Terminal dimensions must be positive integers' });
        }
        yield* Effect.sync(() => terminal.process.resize(cols, rows));
      }),
      close: Effect.fn('TerminalService.close')(function* (id) {
        const terminal = yield* get(id);
        yield* Queue.offer(terminal.events, { _tag: 'Exit', exitCode: 0 }).pipe(Effect.andThen(Queue.end(terminal.events)));
        yield* Fiber.interrupt(terminal.tracker);
        yield* publish(id, undefined);
        yield* transitions.withPermits(1)(
          Ref.update(terminals, (all) => {
            const next = new Map(all);
            next.delete(id);
            return next;
          }).pipe(Effect.andThen(bus.retract({ _tag: 'Terminal', terminalId: id }))),
        );
        yield* closeProcess(terminal);
      }),
    });
  }),
);

/** Needs the `NotificationBus`, which the handlers share with the Subscribers. */
export const layerTerminalService = layerTerminalServiceCore.pipe(Layer.provide(nativePtyHost));

/** With its own bus, which the test also gets, so it can listen to what the Terminals publish. */
export const layerTerminalServiceTest = (
  host: typeof PtyHost.Service,
  channel: typeof HookChannel.Service = quietHookChannel,
): Layer.Layer<TerminalService | NotificationBus> =>
  layerTerminalServiceCore.pipe(
    Layer.provide(Layer.succeed(PtyHost, host)),
    Layer.provide(Layer.succeed(HookChannel, channel)),
    Layer.provideMerge(layerNotificationBus),
  );
