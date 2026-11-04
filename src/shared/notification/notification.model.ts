import { Schema } from 'effect';
import { TerminalId } from '../terminal/terminal.model';

/** What a Terminal is doing (GLOSSARY: Terminal status). Waiting is not produced yet: the Hook and the output tap will. */
export const TerminalStatus = Schema.Literals(['Idle', 'Working', 'Waiting', 'Done', 'Error']).annotate({ identifier: 'TerminalStatus' });
export type TerminalStatus = typeof TerminalStatus.Type;

/** The thing a Notification is about. Only the Terminal for now; each kind of Source defines its own types. */
export const TerminalSource = Schema.Struct({ _tag: Schema.Literal('Terminal'), terminalId: TerminalId }).annotate({
  identifier: 'TerminalSource',
});
export type TerminalSource = typeof TerminalSource.Type;

export const Source = TerminalSource;
export type Source = typeof Source.Type;

/** A Source entering a status. */
export const Notification = Schema.Struct({ source: Source, type: TerminalStatus }).annotate({ identifier: 'Notification' });
export type Notification = typeof Notification.Type;

/** Identifies a Source among the others, in the bus in main and in every Subscriber. */
export const sourceKey = (source: Source): string => `${source._tag}:${source.terminalId}`;

/** What a Subscriber hears: a Source entered a status, or it ceased to exist (which is not a status). */
export const NotificationEvent = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Notified'), notification: Notification }),
  Schema.Struct({ _tag: Schema.Literal('Retracted'), source: Source }),
]).annotate({ identifier: 'NotificationEvent' });
export type NotificationEvent = typeof NotificationEvent.Type;
