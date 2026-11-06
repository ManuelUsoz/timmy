import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Stream } from 'effect';
import type { Notification } from '../../src/shared/notification/notification.model';
import { TerminalId } from '../../src/shared/terminal/terminal.model';
import { WindowHost, layerWindowService, WindowService } from '../window/window-service';
import { NotificationBus, layerNotificationBus } from './notification-bus';
import { OnScreen, layerOnScreen } from './on-screen';

const id = TerminalId.make('a');
const source = { _tag: 'Terminal', terminalId: id } as const;

const host = Layer.succeed(WindowHost, {
  workArea: Effect.succeed({ x: 0, y: 0, width: 1920, height: 1040 }),
  apply: () => Effect.succeed(true),
  close: Effect.void,
  minimize: Effect.void,
  toggleMaximize: Effect.void,
  maximized: Stream.empty,
  visible: Stream.make(true),
  cursor: Stream.empty,
});

const layer = layerOnScreen.pipe(
  Layer.provideMerge(layerWindowService.pipe(Layer.provide(host))),
  Layer.provideMerge(layerNotificationBus),
);

/** What a new Subscriber is told about the Terminal now. */
const latest = Effect.gen(function* () {
  const bus = yield* NotificationBus;
  const [heard] = yield* bus.subscribe.pipe(Stream.take(1), Stream.runCollect);
  return heard;
});

const notified = (seen: boolean) => ({ _tag: 'Notified', notification: { source, type: 'Error', seen, onScreen: seen } satisfies Notification });

describe('OnScreen', () => {
  it.effect('a Terminal that errors while the window is a Pill stays unseen, and is Seen once the Panel opens on it', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      const windows = yield* WindowService;
      const onScreen = yield* OnScreen;
      yield* onScreen.report(id);
      yield* bus.publish({ source, type: 'Error' });
      expect(yield* latest).toEqual(notified(false));
      yield* windows.request('Panel');
      yield* Effect.yieldNow;
      expect(yield* latest).toEqual(notified(true));
    }).pipe(Effect.provide(layer)),
  );

  it.effect('selecting a Terminal while in the Pill does not mark it Seen', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      const onScreen = yield* OnScreen;
      yield* bus.publish({ source, type: 'Error' });
      yield* onScreen.report(id);
      expect(yield* latest).toEqual(notified(false));
    }).pipe(Effect.provide(layer)),
  );

  it.effect('a Terminal that errors while the Panel is open on it is Seen at once', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      const windows = yield* WindowService;
      const onScreen = yield* OnScreen;
      yield* windows.request('Panel');
      yield* onScreen.report(id);
      yield* bus.publish({ source, type: 'Working' });
      yield* bus.publish({ source, type: 'Error' });
      expect(yield* latest).toEqual(notified(true));
    }).pipe(Effect.provide(layer)),
  );

  it.effect('going back to the Pill stops what was shown from counting, and the Expanded workspace counts', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      const windows = yield* WindowService;
      const onScreen = yield* OnScreen;
      yield* windows.request('Expanded');
      yield* onScreen.report(id);
      yield* windows.request('Pill');
      yield* Effect.yieldNow;
      yield* bus.publish({ source, type: 'Error' });
      expect(yield* latest).toEqual(notified(false));
      yield* windows.request('Expanded');
      yield* Effect.yieldNow;
      expect(yield* latest).toEqual(notified(true));
    }).pipe(Effect.provide(layer)),
  );

  it.effect('reporting nothing stops the Terminal counting as on screen', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      const windows = yield* WindowService;
      const onScreen = yield* OnScreen;
      yield* windows.request('Panel');
      yield* onScreen.report(id);
      yield* onScreen.report(undefined);
      yield* bus.publish({ source, type: 'Error' });
      expect(yield* latest).toEqual(notified(false));
    }).pipe(Effect.provide(layer)),
  );
});
