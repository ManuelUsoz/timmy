import { Schema } from 'effect';
import { TerminalId } from '../terminal/terminal.model';

/** What a Terminal is doing (GLOSSARY: Terminal status). Waiting comes from a Provider's Hook, or from a bell or notification in the output of a Terminal without one. */
export const TerminalStatus = Schema.Literals(['Idle', 'Working', 'Waiting', 'Done', 'Error']).annotate({ identifier: 'TerminalStatus' });
export type TerminalStatus = typeof TerminalStatus.Type;

/** The thing a Notification is about. Only the Terminal for now; each kind of Source defines its own types. */
export const TerminalSource = Schema.Struct({ _tag: Schema.Literal('Terminal'), terminalId: TerminalId }).annotate({
  identifier: 'TerminalSource',
});
export type TerminalSource = typeof TerminalSource.Type;

export const Source = TerminalSource;
export type Source = typeof Source.Type;

/** What a Source publishes: it entered a status. Whether anyone has seen it is for the bus to say. */
export const Entered = Schema.Struct({ source: Source, type: TerminalStatus }).annotate({ identifier: 'Entered' });
export type Entered = typeof Entered.Type;

/**
 * A Source entering a status. `seen` is true for a Done or Error the user has viewed (GLOSSARY: Seen); it is never true
 * for any other status.
 */
export const Notification = Schema.Struct({ ...Entered.fields, seen: Schema.Boolean }).annotate({ identifier: 'Notification' });
export type Notification = typeof Notification.Type;

/** The statuses that can be Seen: what is over, not what is going on or asking for the user. */
export const canBeSeen = (type: TerminalStatus): boolean => type === 'Done' || type === 'Error';

/** Identifies a Source among the others, in the bus in main and in every Subscriber. */
export const sourceKey = (source: Source): string => `${source._tag}:${source.terminalId}`;

/** What a Subscriber hears: a Source entered a status, or it ceased to exist (which is not a status). */
export const NotificationEvent = Schema.Union([
  Schema.Struct({ _tag: Schema.Literal('Notified'), notification: Notification }),
  Schema.Struct({ _tag: Schema.Literal('Retracted'), source: Source }),
]).annotate({ identifier: 'NotificationEvent' });
export type NotificationEvent = typeof NotificationEvent.Type;
