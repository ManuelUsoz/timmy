import { Schema } from 'effect';
import { HookSignal } from '../hooks/hooks.model';

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

/**
 * One report of a Provider's Hook about a live Terminal, as it arrived: a tool use reads `Working` every time, though the
 * Terminal's status only changes once. What listens for "the agent did something" (the changed markers) needs each one.
 */
export const TerminalHookReport = Schema.Struct({ terminalId: TerminalId, signal: HookSignal }).annotate({ identifier: 'TerminalHookReport' });
export type TerminalHookReport = typeof TerminalHookReport.Type;
