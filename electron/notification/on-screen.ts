import { Context, Effect, Layer, Ref, Scope, Semaphore, Stream } from 'effect';
import type { TerminalId } from '../../src/shared/terminal/terminal.model';
import { WindowService } from '../window/window-service';
import { NotificationBus } from './notification-bus';

/**
 * What is on screen, which decides what is Seen (GLOSSARY: Seen). The renderer reports only the Terminal its screen is
 * showing; main combines that with the Window mode, because the Pill shows no Terminal whatever the renderer last said.
 */
export class OnScreen extends Context.Service<OnScreen, {
  /** The Terminal the renderer is showing, or none. */
  readonly report: (terminalId: TerminalId | undefined) => Effect.Effect<void>;
}>()('notification/OnScreen') {}

export const layerOnScreen: Layer.Layer<OnScreen, never, NotificationBus | WindowService> = Layer.effect(
  OnScreen,
  Effect.gen(function* () {
    const bus = yield* NotificationBus;
    const windows = yield* WindowService;
    const scope = yield* Scope.Scope;
    const shown = yield* Ref.make<TerminalId | undefined>(undefined);
    // Reading the mode and telling the bus happen together, so an older answer cannot overtake a newer one.
    const settling = yield* Semaphore.make(1);

    const settle = settling.withPermits(1)(
      Effect.gen(function* () {
        const mode = yield* windows.current;
        const terminalId = yield* Ref.get(shown);
        yield* bus.view(mode === 'Pill' || terminalId === undefined ? undefined : { _tag: 'Terminal', terminalId });
      }),
    );

    yield* windows.modes.pipe(Stream.runForEach(() => settle), Effect.forkIn(scope));

    return OnScreen.of({
      report: Effect.fn('OnScreen.report')(function* (terminalId) {
        yield* Ref.set(shown, terminalId);
        yield* settle;
      }),
    });
  }),
);
