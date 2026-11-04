import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Stream } from 'effect';
import type { Notification, Source } from '../../src/shared/notification/notification.model';
import { TerminalId } from '../../src/shared/terminal/terminal.model';
import { NotificationBus, layerNotificationBus } from './notification-bus';

const source = (id: string): Source => ({ _tag: 'Terminal', terminalId: TerminalId.make(id) });
const notification = (id: string, type: Notification['type']): Notification => ({ source: source(id), type });

describe('NotificationBus', () => {
  it.effect('replays the latest Notification of every Source to a late Subscriber', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      yield* bus.publish(notification('a', 'Idle'));
      yield* bus.publish(notification('a', 'Working'));
      yield* bus.publish(notification('b', 'Done'));
      const heard = yield* bus.subscribe.pipe(Stream.take(2), Stream.runCollect);
      expect(heard).toEqual([
        { _tag: 'Notified', notification: notification('a', 'Working') },
        { _tag: 'Notified', notification: notification('b', 'Done') },
      ]);
    }).pipe(Effect.provide(layerNotificationBus)),
  );

  it.effect('delivers a Notification published after the Subscriber connected', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      const fiber = yield* bus.subscribe.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
      yield* Effect.yieldNow;
      yield* bus.publish(notification('a', 'Working'));
      yield* bus.publish(notification('a', 'Error'));
      expect(yield* Fiber.join(fiber)).toEqual([
        { _tag: 'Notified', notification: notification('a', 'Working') },
        { _tag: 'Notified', notification: notification('a', 'Error') },
      ]);
    }).pipe(Effect.provide(layerNotificationBus)),
  );

  it.effect('drops a retracted Source from the replay and tells the Subscribers it ended', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      yield* bus.publish(notification('a', 'Working'));
      yield* bus.publish(notification('b', 'Working'));
      const live = yield* bus.subscribe.pipe(Stream.take(3), Stream.runCollect, Effect.forkChild);
      yield* Effect.yieldNow;
      yield* bus.retract(source('a'));
      expect(yield* Fiber.join(live)).toEqual([
        { _tag: 'Notified', notification: notification('a', 'Working') },
        { _tag: 'Notified', notification: notification('b', 'Working') },
        { _tag: 'Retracted', source: source('a') },
      ]);
      const late = yield* bus.subscribe.pipe(Stream.take(1), Stream.runCollect);
      expect(late).toEqual([{ _tag: 'Notified', notification: notification('b', 'Working') }]);
    }).pipe(Effect.provide(layerNotificationBus)),
  );

  it.effect('says nothing when a Source re-enters the status it already has, or when an unknown Source is retracted', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      const fiber = yield* bus.subscribe.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
      yield* Effect.yieldNow;
      yield* bus.retract(source('ghost'));
      yield* bus.publish(notification('a', 'Working'));
      yield* bus.publish(notification('a', 'Working'));
      yield* bus.publish(notification('a', 'Done'));
      expect(yield* Fiber.join(fiber)).toEqual([
        { _tag: 'Notified', notification: notification('a', 'Working') },
        { _tag: 'Notified', notification: notification('a', 'Done') },
      ]);
    }).pipe(Effect.provide(layerNotificationBus)),
  );
});
