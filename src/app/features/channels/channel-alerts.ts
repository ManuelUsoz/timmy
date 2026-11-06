import { Schema } from 'effect';
import { sourceKey, type Notification, type NotificationEvent, type TerminalStatus } from '../../../shared/notification/notification.model';
import { AlertType, type ChannelSettings } from '../../../shared/settings/settings.model';

/** A Notification a Channel alerts about: its type is one the user can switch. */
export type Alert = Notification & { readonly type: AlertType };

/** How a Channel alerts the user. One per Channel. */
export interface ChannelDelivery {
  alert(alert: Alert): void;
}

/** The status of every Source a Channel has heard of, so it can tell a Source entering a status from anything else. */
export type Heard = ReadonlyMap<string, TerminalStatus>;

/**
 * What is news in `event`: the Notification of a Source that entered a status, if it did. A Done or Error becoming
 * Seen repeats the status the Source already had, and a retraction is not a status, so neither is news.
 */
export const news = (heard: Heard, event: NotificationEvent): { readonly heard: Heard; readonly news: Notification | undefined } => {
  const next = new Map(heard);
  if (event._tag === 'Retracted') {
    next.delete(sourceKey(event.source));
    return { heard: next, news: undefined };
  }
  const { notification } = event;
  const key = sourceKey(notification.source);
  const changed = heard.get(key) !== notification.type;
  next.set(key, notification.type);
  return { heard: next, news: changed ? notification : undefined };
};

const isAlertType = Schema.is(AlertType);

/**
 * Whether a Channel configured as `settings` alerts about a Source entering a status. Working and Idle never alert, and
 * neither does a Source the user is looking at or has already seen (GLOSSARY: Channel).
 */
export const alerts = (settings: ChannelSettings, notification: Notification): notification is Alert =>
  settings.enabled &&
  !notification.onScreen &&
  !notification.seen &&
  isAlertType(notification.type) &&
  settings.types.includes(notification.type);
