import { Schema } from 'effect';

export const TerminalId = Schema.String.pipe(Schema.brand('TerminalId'));
export type TerminalId = typeof TerminalId.Type;

export const TerminalEvent = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Data'), data: Schema.String }),
  Schema.Struct({ _tag: Schema.Literal('Exit'), exitCode: Schema.Number }),
]).annotate({ identifier: 'TerminalEvent' });
export type TerminalEvent = typeof TerminalEvent.Type;

/** What a Terminal is doing, read from its output: printing, quiet, or asking for the user (a bell or a notification). */
export const TerminalActivity = Schema.Literals(['Active', 'Idle', 'NeedsAttention']).annotate({ identifier: 'TerminalActivity' });
export type TerminalActivity = typeof TerminalActivity.Type;

export const TerminalActivityEntry = Schema.Struct({ terminalId: TerminalId, activity: TerminalActivity }).annotate({
  identifier: 'TerminalActivityEntry',
});
export type TerminalActivityEntry = typeof TerminalActivityEntry.Type;
