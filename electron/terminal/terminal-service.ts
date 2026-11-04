import { Context, Duration, Effect, Fiber, Layer, Option, Queue, Ref, Scope, Stream, SubscriptionRef } from 'effect';
import type { Cause } from 'effect';
import * as pty from 'node-pty';
import type { IPty, IWindowsPtyForkOptions } from 'node-pty';
import type { Provider } from '../../src/shared/settings/settings.model';
import { TerminalError } from '../../src/shared/terminal/terminal-error.model';
import type { TerminalActivity, TerminalActivityEntry, TerminalEvent, TerminalId } from '../../src/shared/terminal/terminal.model';
import { TerminalId as TerminalIdSchema } from '../../src/shared/terminal/terminal.model';
import { makeOutputTap } from './output-tap';
import { providerCommand } from './provider-command';
import { activityOf, initialActivity, nextActivity, type ActivityEvent } from './terminal-activity';

export interface PtyProcess {
  readonly onData: (listener: (data: string) => void) => { dispose: () => void };
  readonly onExit: (listener: (event: { exitCode: number }) => void) => { dispose: () => void };
  readonly write: (data: string) => void;
  readonly resize: (cols: number, rows: number) => void;
  readonly kill: () => void;
}

export class PtyHost extends Context.Service<PtyHost, {
  readonly spawn: (cwd: string) => Effect.Effect<PtyProcess, TerminalError>;
}>()('terminal/PtyHost') {}

/** How long a Terminal must be quiet before it counts as Idle instead of Active. */
export const IDLE_AFTER_MS = 2000;

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
  spawn: Effect.fn('PtyHost.spawn')(function* (cwd) {
    let lastError: unknown;
    for (const shell of shellCandidates()) {
      try {
        const options: IWindowsPtyForkOptions = { name: 'xterm-256color', cols: 120, rows: 34, cwd, env: process.env };
        return pty.spawn(shell, [], options) as unknown as PtyProcess;
      } catch (error) {
        lastError = error;
      }
    }
    return yield* new TerminalError({ reason: 'PtyUnavailable', detail: String(lastError ?? 'No shell is available') });
  }),
});

export class TerminalService extends Context.Service<TerminalService, {
  /** With a Provider, its CLI command is typed into the new shell: the shell outlives the CLI. */
  readonly create: (cwd: string, provider?: Provider) => Effect.Effect<TerminalId, TerminalError>;
  readonly output: (id: TerminalId) => Stream.Stream<TerminalEvent, TerminalError>;
  /** The activity of every Terminal: the current one first, then a new snapshot at each change. */
  readonly activity: Stream.Stream<ReadonlyArray<TerminalActivityEntry>>;
  /** The user is on the Terminal: a bell or notification it raised has been seen. */
  readonly focus: (id: TerminalId) => Effect.Effect<void, TerminalError>;
  readonly write: (id: TerminalId, data: string) => Effect.Effect<void, TerminalError>;
  readonly resize: (id: TerminalId, cols: number, rows: number) => Effect.Effect<void, TerminalError>;
  readonly close: (id: TerminalId) => Effect.Effect<void, TerminalError>;
}>()('terminal/TerminalService') {}

const layerTerminalServiceCore = Layer.effect(
  TerminalService,
  Effect.gen(function* () {
    const host = yield* PtyHost;
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
     * Folds a Terminal's activity events into its activity. While it is busy the wait for the next event is bounded:
     * running out means it went quiet. Ends when the queue does (the process exited or the Terminal was closed).
     */
    const trackActivity = Effect.fnUntraced(function* (id: TerminalId, events: Queue.Queue<ActivityEvent, Cause.Done>) {
      let state = initialActivity;
      while (true) {
        const next = state.busy
          ? yield* Queue.take(events).pipe(Effect.timeoutOption(Duration.millis(IDLE_AFTER_MS)))
          : Option.some(yield* Queue.take(events));
        state = nextActivity(state, Option.getOrElse(next, (): ActivityEvent => 'Quiet'));
        yield* publish(id, activityOf(state));
      }
    });

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

    yield* Effect.addFinalizer(() =>
      Ref.get(terminals).pipe(
        Effect.flatMap((all) => Effect.forEach(all.values(), closeProcess, { discard: true })),
      ),
    );

    return TerminalService.of({
      create: Effect.fn('TerminalService.create')(function* (cwd, provider) {
        if (cwd.trim() === '') return yield* new TerminalError({ reason: 'InvalidCwd', detail: 'A terminal needs a project folder' });
        const process = yield* host.spawn(cwd);
        const id = TerminalIdSchema.make(crypto.randomUUID());
        const events = yield* Queue.unbounded<TerminalEvent, Cause.Done>();
        const activity = yield* Queue.unbounded<ActivityEvent, Cause.Done>();
        // The tap reads a copy of the output: what the renderer receives is not changed by it.
        const tap = makeOutputTap();
        process.onData((data) =>
          Effect.runFork(
            Queue.offer(events, { _tag: 'Data', data }).pipe(Effect.andThen(Queue.offerAll(activity, tap.scan(data)))),
          ),
        );
        process.onExit(({ exitCode }) => {
          // The terminal stays listed until it is closed, so a screen opened after the exit still reads it.
          Effect.runFork(
            Queue.offer(events, { _tag: 'Exit', exitCode }).pipe(
              Effect.andThen(Queue.end(events)),
              Effect.andThen(Queue.offer(activity, 'Exited')),
              Effect.andThen(Queue.end(activity)),
            ),
          );
        });
        yield* publish(id, 'Idle');
        const tracker = yield* trackActivity(id, activity).pipe(Effect.ignore, Effect.forkIn(scope));
        const terminal = { process, events, activity, tracker };
        yield* Ref.update(terminals, (all) => new Map(all).set(id, terminal));
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
        yield* closeProcess(terminal);
        yield* Ref.update(terminals, (all) => {
          const next = new Map(all);
          next.delete(id);
          return next;
        });
      }),
    });
  }),
);

export const layerTerminalService = layerTerminalServiceCore.pipe(Layer.provide(nativePtyHost));

export const layerTerminalServiceTest = (host: typeof PtyHost.Service): Layer.Layer<TerminalService> =>
  layerTerminalServiceCore.pipe(Layer.provide(Layer.succeed(PtyHost, host)));
