import { Rpc, RpcGroup } from 'effect/rpc';
import { NotificationEvent } from './notification.model';

/** Notifications flow through a bus in main; the renderer is one of its Subscribers (ADR 0010). */
export const NotificationRpcs = RpcGroup.make(
  Rpc.make('Notification.subscribe', {
    /** The latest Notification of every Source that still exists, then every Notification and every retraction. */
    success: NotificationEvent,
    stream: true,
  }),
);
