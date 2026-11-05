import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { Provider } from '../settings/settings.model';
import { TerminalError } from './terminal-error.model';
import { TerminalActivityEntry, TerminalEvent, TerminalId } from './terminal.model';

export const TerminalRpcs = RpcGroup.make(
  Rpc.make('Terminal.create', {
    /** With a Provider, the Terminal types that Provider's CLI into the shell it opens. */
    payload: { cwd: Schema.String, provider: Schema.optional(Provider) },
    success: Schema.Struct({ terminalId: TerminalId }),
    error: TerminalError,
  }),
  Rpc.make('Terminal.output', {
    payload: { terminalId: TerminalId },
    success: TerminalEvent,
    error: TerminalError,
    stream: true,
  }),
  Rpc.make('Terminal.activity', {
    /** What every Terminal is doing, read from its output: the current activity of all of them, then again at each change. */
    success: Schema.Array(TerminalActivityEntry),
    stream: true,
  }),
  Rpc.make('Terminal.focus', {
    /** The user is on this Terminal: whatever asked for their attention has been seen. */
    payload: { terminalId: TerminalId },
    success: Schema.Void,
    error: TerminalError,
  }),
  Rpc.make('Terminal.show', {
    /**
     * The Terminal the renderer's screen is showing, or none. Main decides whether that is on screen from the Window mode,
     * and a Done or Error Terminal on screen is Seen (GLOSSARY: Seen).
     */
    payload: { terminalId: Schema.optional(TerminalId) },
    success: Schema.Void,
  }),
  Rpc.make('Terminal.write', {
    payload: { terminalId: TerminalId, data: Schema.String },
    success: Schema.Void,
    error: TerminalError,
  }),
  Rpc.make('Terminal.resize', {
    payload: { terminalId: TerminalId, cols: Schema.Number, rows: Schema.Number },
    success: Schema.Void,
    error: TerminalError,
  }),
  Rpc.make('Terminal.close', {
    payload: { terminalId: TerminalId },
    success: Schema.Void,
    error: TerminalError,
  }),
);
