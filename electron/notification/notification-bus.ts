import { Context, Effect, Layer, PubSub, Ref, Semaphore, Stream } from 'effect';
import { sourceKey, type Notification, type NotificationEvent, type Source } from '../../src/shared/notification/notification.model';

/**
 * The Notification bus (ADR 0010). Sources publish what they are doing; Subscribers listen.
 * It keeps the latest Notification of every Source that still exists and replays them to each new Subscriber.
 */
export class NotificationBus extends Context.Service<NotificationBus, {
  /** A Source entered a status. Entering the status it already has is not a Notification. */
  readonly publish: (notification: Notification) => Effect.Effect<void>;
  /** The Source ceased to exist: its replay is dropped and the Subscribers hear that it ended. */
  readonly retract: (source: Source) => Effect.Effect<void>;
  /** The latest Notification of every Source that still exists, then every change. */
  readonly subscribe: Stream.Stream<NotificationEvent>;
}>()('notification/NotificationBus') {}

export const layerNotificationBus: Layer.Layer<NotificationBus> = Layer.effect(
  NotificationBus,
  Effect.gen(function* () {
    const latest = yield* Ref.make<ReadonlyMap<string, Notification>>(new Map());
    const events = yield* PubSub.unbounded<NotificationEvent>();
    // The latest map and the published event change together, so a Subscriber never sees one without the other.
    const writing = yield* Semaphore.make(1);

    const publish = Effect.fn('NotificationBus.publish')(function* (notification: Notification) {
      yield* writing.withPermits(1)(
        Effect.gen(function* () {
          const key = sourceKey(notification.source);
          const known = (yield* Ref.get(latest)).get(key);
          if (known?.type === notification.type) return;
          yield* Ref.update(latest, (all) => new Map(all).set(key, notification));
          yield* PubSub.publish(events, { _tag: 'Notified', notification });
        }),
      );
    });

    const retract = Effect.fn('NotificationBus.retract')(function* (source: Source) {
      yield* writing.withPermits(1)(
        Effect.gen(function* () {
          const key = sourceKey(source);
          if (!(yield* Ref.get(latest)).has(key)) return;
          yield* Ref.update(latest, (all) => {
            const next = new Map(all);
            next.delete(key);
            return next;
          });
          yield* PubSub.publish(events, { _tag: 'Retracted', source });
        }),
      );
    });

    // Connecting and reading the replay happen under the same permit as publishing, so no change falls between them.
    const subscribe = Stream.unwrap(
      writing.withPermits(1)(
        Effect.gen(function* () {
          const subscription = yield* PubSub.subscribe(events);
          const replay = Array.from((yield* Ref.get(latest)).values(), (notification): NotificationEvent => ({ _tag: 'Notified', notification }));
          return Stream.concat(Stream.fromIterable(replay), Stream.fromSubscription(subscription));
        }),
      ),
    );

    return NotificationBus.of({ publish, retract, subscribe });
  }),
);
