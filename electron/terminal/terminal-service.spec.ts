import { describe, expect, it } from '@effect/vitest';
import { Effect, Stream } from 'effect';
import type { Provider } from '../../src/shared/settings/settings.model';
import { TerminalService, layerTerminalServiceTest, type PtyProcess } from './terminal-service';

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
