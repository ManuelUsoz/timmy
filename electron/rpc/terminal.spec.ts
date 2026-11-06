import { describe, expect, it } from '@effect/vitest';
import { Effect, Layer, Stream } from 'effect';
import { DesktopApi } from '../../src/app/core/desktop-api';
import { makeDesktopTestLayer } from '../../src/app/core/desktop-layers';
import { TerminalId } from '../../src/shared/terminal/terminal.model';
import { NotificationBus } from '../notification/notification-bus';
import { layerOnScreen } from '../notification/on-screen';
import { layerTerminalServiceTest } from '../terminal/terminal-service';
import { WindowHost, WindowService, layerWindowService } from '../window/window-service';
import { layerTerminalHandlers } from './terminal';

const source = { _tag: 'Terminal', terminalId: TerminalId.make('t1') } as const;

const windowHost = Layer.succeed(WindowHost, {
  workArea: Effect.succeed({ x: 0, y: 0, width: 1920, height: 1040 }),
  apply: () => Effect.succeed(true),
  close: Effect.void,
  minimize: Effect.void,
  toggleMaximize: Effect.void,
  maximized: Stream.empty,
  visible: Stream.make(true),
  cursor: Stream.empty,
});

// The handlers and the test share the bus and the window, as the app's handlers do.
const services = layerOnScreen.pipe(
  Layer.provideMerge(layerWindowService.pipe(Layer.provide(windowHost))),
  Layer.provideMerge(layerTerminalServiceTest({ spawn: () => Effect.die('no process in this test') })),
);
const layer = Layer.mergeAll(makeDesktopTestLayer(layerTerminalHandlers.pipe(Layer.provide(services))), services);

describe('Terminal.show', () => {
  it.effect('marks a Terminal that failed Seen once the Panel is open on it, and only then', () =>
    Effect.gen(function* () {
      const bus = yield* NotificationBus;
      const windows = yield* WindowService;
      const api = yield* DesktopApi;
      const heard = Effect.map(Stream.runCollect(Stream.take(bus.subscribe, 1)), ([event]) => event);
      yield* bus.publish({ source, type: 'Error' });

      yield* api['Terminal.show']({ terminalId: source.terminalId });
      expect(yield* heard).toEqual({ _tag: 'Notified', notification: { source, type: 'Error', seen: false, onScreen: false } });

      yield* windows.request('Panel');
      yield* api['Terminal.show']({ terminalId: source.terminalId });
      expect(yield* heard).toEqual({ _tag: 'Notified', notification: { source, type: 'Error', seen: true, onScreen: true } });
    }).pipe(Effect.provide(layer)),
  );
});
