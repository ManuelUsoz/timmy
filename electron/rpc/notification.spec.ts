import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Stream } from 'effect';
import { DesktopApi } from '../../src/app/core/desktop-api';
import { makeDesktopTestLayer } from '../../src/app/core/desktop-layers';
import { TerminalId } from '../../src/shared/terminal/terminal.model';
import { NotificationBus, layerNotificationBus } from '../notification/notification-bus';
import { layerNotificationHandlers } from './notification';

const source = { _tag: 'Terminal', terminalId: TerminalId.make('t1') } as const;

// The handlers and the test share one bus, as the app's handlers and the Terminals do.
const layer = Layer.mergeAll(makeDesktopTestLayer(layerNotificationHandlers.pipe(Layer.provide(layerNotificationBus))), layerNotificationBus);

describe('Notification.subscribe', () => {
  it.live('streams the latest Notification of every Source, then the changes and the retractions', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      const api = yield* DesktopApi;
      yield* bus.publish({ source, type: 'Working' });
      const heard = yield* Effect.gen(function* () {
        yield* Effect.forkChild(bus.publish({ source, type: 'Done' }).pipe(Effect.andThen(bus.retract(source)), Effect.delay(20)));
        return yield* api['Notification.subscribe']().pipe(Stream.take(3), Stream.runCollect);
      });
      expect(heard).toEqual([
        { _tag: 'Notified', notification: { source, type: 'Working', seen: false, onScreen: false } },
        { _tag: 'Notified', notification: { source, type: 'Done', seen: false, onScreen: false } },
        { _tag: 'Retracted', source },
      ]);
    }).pipe(Effect.provide(layer)),
  );
});
