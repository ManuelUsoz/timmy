import { Effect } from 'effect';
import { NotificationRpcs } from '../../src/shared/notification/notification.rpc';
import { NotificationBus } from '../notification/notification-bus';

export const layerNotificationHandlers = NotificationRpcs.toLayer(
  Effect.gen(function* () {
    const bus = yield* NotificationBus;
    return {
      'Notification.subscribe': () => bus.subscribe,
    };
  }),
);
