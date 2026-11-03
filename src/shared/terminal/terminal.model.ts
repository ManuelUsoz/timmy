import { Schema } from 'effect';

export const TerminalId = Schema.String.pipe(Schema.brand('TerminalId'));
export type TerminalId = typeof TerminalId.Type;

export const TerminalEvent = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Data'), data: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('Exit'), exitCode: Schema.Number }),
]).annotate({ identifier: 'TerminalEvent' });
export type TerminalEvent = typeof TerminalEvent.Type;
