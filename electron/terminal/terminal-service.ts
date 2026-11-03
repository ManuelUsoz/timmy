import { Context, Effect, Layer, Queue, Ref, Stream } from 'effect';
import type { Cause } from 'effect';
import * as pty from 'node-pty';
import type { IPty, IWindowsPtyForkOptions } from 'node-pty';
import { TerminalError } from '../../src/shared/terminal/terminal-error.model';
import type { TerminalEvent, TerminalId } from '../../src/shared/terminal/terminal.model';
import { TerminalId as TerminalIdSchema } from '../../src/shared/terminal/terminal.model';

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

type Terminal = {
  readonly process: PtyProcess;
  readonly events: Queue.Queue<TerminalEvent, Cause.Done>;
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
  readonly create: (cwd: string) => Effect.Effect<TerminalId, TerminalError>;
  readonly output: (id: TerminalId) => Stream.Stream<TerminalEvent, TerminalError>;
  readonly write: (id: TerminalId, data: string) => Effect.Effect<void, TerminalError>;
  readonly resize: (id: TerminalId, cols: number, rows: number) => Effect.Effect<void, TerminalError>;
  readonly close: (id: TerminalId) => Effect.Effect<void, TerminalError>;
}>()('terminal/TerminalService') {}

const layerTerminalServiceCore = Layer.effect(
  TerminalService,
  Effect.gen(function* () {
    const host = yield* PtyHost;
    const terminals = yield* Ref.make<ReadonlyMap<TerminalId, Terminal>>(new Map());

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
      create: Effect.fn('TerminalService.create')(function* (cwd) {
        if (cwd.trim() === '') return yield* new TerminalError({ reason: 'InvalidCwd', detail: 'A terminal needs a project folder' });
        const process = yield* host.spawn(cwd);
        const id = TerminalIdSchema.make(crypto.randomUUID());
        const events = yield* Queue.unbounded<TerminalEvent, Cause.Done>();
        const terminal = { process, events };
        process.onData((data) => Effect.runFork(Queue.offer(events, { _tag: 'Data', data })));
        process.onExit(({ exitCode }) => {
          // The terminal stays listed until it is closed, so a screen opened after the exit still reads it.
          Effect.runFork(Queue.offer(events, { _tag: 'Exit', exitCode }).pipe(Effect.andThen(Queue.end(events))));
        });
        yield* Ref.update(terminals, (all) => new Map(all).set(id, terminal));
        return id;
      }),
      output: (id) => Stream.unwrap(get(id).pipe(Effect.map((terminal) => Stream.fromQueue(terminal.events)))), 
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
