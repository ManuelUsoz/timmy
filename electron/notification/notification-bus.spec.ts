import { describe, expect, it } from '@effect/vitest';
import { Effect, Fiber, Stream } from 'effect';
import type { Entered, Notification, Source } from '../../src/shared/notification/notification.model';
import { TerminalId } from '../../src/shared/terminal/terminal.model';
import { NotificationBus, layerNotificationBus } from './notification-bus';

const source = (id: string): Source => ({ _tag: 'Terminal', terminalId: TerminalId.make(id) });
const entered = (id: string, type: Notification['type']): Entered => ({ source: source(id), type });
const notification = (id: string, type: Notification['type'], seen = false, onScreen = false): Notification => ({ ...entered(id, type), seen, onScreen });

describe('NotificationBus', () => {
  it.effect('replays the latest Notification of every Source to a late Subscriber', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      yield* bus.publish(entered('a', 'Idle'));
      yield* bus.publish(entered('a', 'Working'));
      yield* bus.publish(entered('b', 'Done'));
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
      yield* bus.publish(entered('a', 'Working'));
      yield* bus.publish(entered('a', 'Error'));
      expect(yield* Fiber.join(fiber)).toEqual([
        { _tag: 'Notified', notification: notification('a', 'Working') },
        { _tag: 'Notified', notification: notification('a', 'Error') },
      ]);
    }).pipe(Effect.provide(layerNotificationBus)),
  );

  it.effect('drops a retracted Source from the replay and tells the Subscribers it ended', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      yield* bus.publish(entered('a', 'Working'));
      yield* bus.publish(entered('b', 'Working'));
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
      yield* bus.publish(entered('a', 'Working'));
      yield* bus.publish(entered('a', 'Working'));
      yield* bus.publish(entered('a', 'Done'));
      expect(yield* Fiber.join(fiber)).toEqual([
        { _tag: 'Notified', notification: notification('a', 'Working') },
        { _tag: 'Notified', notification: notification('a', 'Done') },
      ]);
    }).pipe(Effect.provide(layerNotificationBus)),
  );

  describe('Seen', () => {
    it.effect('marks a Done or Error Source Seen when its content is on screen, and says so to the Subscribers', () =>
      Effect.gen(function* () {
        const bus = yield* NotificationBus;
        yield* bus.publish(entered('a', 'Error'));
        const fiber = yield* bus.subscribe.pipe(Stream.take(2), Stream.runCollect, Effect.forkChild);
        yield* Effect.yieldNow;
        yield* bus.view(source('a'));
        expect(yield* Fiber.join(fiber)).toEqual([
          { _tag: 'Notified', notification: notification('a', 'Error') },
          { _tag: 'Notified', notification: notification('a', 'Error', true, true) },
        ]);
        const late = yield* bus.subscribe.pipe(Stream.take(1), Stream.runCollect);
        expect(late).toEqual([{ _tag: 'Notified', notification: notification('a', 'Error', true, true) }]);
      }).pipe(Effect.provide(layerNotificationBus)),
    );

    it.effect('does not mark a Source Seen when another one is on screen, or none', () =>
      Effect.gen(function* () {
        const bus = yield* NotificationBus;
        yield* bus.publish(entered('a', 'Done'));
        yield* bus.view(source('b'));
        yield* bus.view(undefined);
        const heard = yield* bus.subscribe.pipe(Stream.take(1), Stream.runCollect);
        expect(heard).toEqual([{ _tag: 'Notified', notification: notification('a', 'Done') }]);
      }).pipe(Effect.provide(layerNotificationBus)),
    );

    it.effect('marks a Done or Error Seen the moment it happens on a Source that is on screen', () =>
      Effect.gen(function* () {
        const bus = yield* NotificationBus;
        yield* bus.view(source('a'));
        yield* bus.publish(entered('a', 'Working'));
        yield* bus.publish(entered('a', 'Done'));
        const heard = yield* bus.subscribe.pipe(Stream.take(1), Stream.runCollect);
        expect(heard).toEqual([{ _tag: 'Notified', notification: notification('a', 'Done', true, true) }]);
      }).pipe(Effect.provide(layerNotificationBus)),
    );

    it.effect('never marks Working or Waiting Seen, on screen or not', () =>
      Effect.gen(function* () {
        const bus = yield* NotificationBus;
        yield* bus.view(source('a'));
        yield* bus.view(source('b'));
        yield* bus.publish(entered('a', 'Working'));
        yield* bus.publish(entered('b', 'Waiting'));
        const heard = yield* bus.subscribe.pipe(Stream.take(2), Stream.runCollect);
        expect(heard).toEqual([
          { _tag: 'Notified', notification: notification('a', 'Working') },
          { _tag: 'Notified', notification: notification('b', 'Waiting', false, true) },
        ]);
      }).pipe(Effect.provide(layerNotificationBus)),
    );

    it.effect('starts unseen again when the Source enters a new status, even after it was Seen', () =>
      Effect.gen(function* () {
        const bus = yield* NotificationBus;
        yield* bus.publish(entered('a', 'Error'));
        yield* bus.view(source('a'));
        yield* bus.view(undefined);
        yield* bus.publish(entered('a', 'Working'));
        yield* bus.publish(entered('a', 'Done'));
        const heard = yield* bus.subscribe.pipe(Stream.take(1), Stream.runCollect);
        expect(heard).toEqual([{ _tag: 'Notified', notification: notification('a', 'Done') }]);
      }).pipe(Effect.provide(layerNotificationBus)),
    );

    it.effect('keeps a Seen Source Seen when it re-enters the status it has', () =>
      Effect.gen(function* () {
        const bus = yield* NotificationBus;
        yield* bus.publish(entered('a', 'Done'));
        yield* bus.view(source('a'));
        yield* bus.view(undefined);
        yield* bus.publish(entered('a', 'Done'));
        const heard = yield* bus.subscribe.pipe(Stream.take(1), Stream.runCollect);
        expect(heard).toEqual([{ _tag: 'Notified', notification: notification('a', 'Done', true) }]);
      }).pipe(Effect.provide(layerNotificationBus)),
    );
  });

  // A Channel does not alert about a Source that is already on screen (GLOSSARY: Channel), whatever its status.
  describe('On screen', () => {
    it.effect('says a Source is on screen when it enters any status while the user is looking at it', () =>
      Effect.gen(function* () {
        const bus = yield* NotificationBus;
        const fiber = yield* bus.subscribe.pipe(Stream.take(3), Stream.runCollect, Effect.forkChild);
        yield* Effect.yieldNow;
        yield* bus.view(source('a'));
        yield* bus.publish(entered('a', 'Waiting'));
        yield* bus.publish(entered('b', 'Waiting'));
        yield* bus.publish(entered('a', 'Error'));
        expect(yield* Fiber.join(fiber)).toEqual([
          { _tag: 'Notified', notification: notification('a', 'Waiting', false, true) },
          { _tag: 'Notified', notification: notification('b', 'Waiting') },
          { _tag: 'Notified', notification: notification('a', 'Error', true, true) },
        ]);
      }).pipe(Effect.provide(layerNotificationBus)),
    );

    it.effect('replays whether each Source is on screen now, not when it entered its status', () =>
      Effect.gen(function* () {
        const bus = yield* NotificationBus;
        yield* bus.publish(entered('a', 'Waiting'));
        yield* bus.view(source('b'));
        yield* bus.publish(entered('b', 'Waiting'));
        yield* bus.view(source('a'));
        const heard = yield* bus.subscribe.pipe(Stream.take(2), Stream.runCollect);
        expect(heard).toEqual([
          { _tag: 'Notified', notification: notification('a', 'Waiting', false, true) },
          { _tag: 'Notified', notification: notification('b', 'Waiting') },
        ]);
      }).pipe(Effect.provide(layerNotificationBus)),
    );
  });
});
