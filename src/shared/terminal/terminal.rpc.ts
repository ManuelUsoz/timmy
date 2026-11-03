import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { TerminalError } from './terminal-error.model';
import { TerminalEvent, TerminalId } from './terminal.model';

export const TerminalRpcs = RpcGroup.make(
  Rpc.make('Terminal.create', {
    payload: { cwd: Schema.String },
    success: Schema.Struct({ terminalId: TerminalId }),
    error: TerminalError,
  }),
  Rpc.make('Terminal.output', {
    payload: { terminalId: TerminalId },
    success: TerminalEvent,
    error: TerminalError,
    stream: true,
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
