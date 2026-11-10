import { Context, Deferred, Effect, Layer, PubSub, Ref, Stream } from 'effect';

/** The longest Timmy waits for the window to save before it quits anyway: quitting must never hang. */
export const QUIT_WAIT_MS = 1500;

/**
 * Holds Timmy's quit until the window has saved its pending layout (ADR 0011). The renderer saves a moment after each
 * change, so a quit right after one would otherwise lose it. Main calls `beforeQuit`; the window listening on
 * `quitting` saves what it has and answers with `saved`. With no window listening, or no answer within `QUIT_WAIT_MS`,
 * Timmy quits at once.
 */
export class QuitGate extends Context.Service<
  QuitGate,
  {
    /** Each time Timmy is about to quit. */
    readonly quitting: Stream.Stream<'Quitting'>;
    /** The window saved what it had: Timmy may quit. */
    readonly saved: Effect.Effect<void>;
    /** Asks the window to save and waits for its answer, at most `QUIT_WAIT_MS`. */
    readonly beforeQuit: Effect.Effect<void>;
  }
>()('workspace/QuitGate') {}

export const layerQuitGate = Layer.effect(
  QuitGate,
  Effect.gen(function* () {
    const requests = yield* PubSub.unbounded<'Quitting'>();
    /** How many windows listen now: a reload replaces the window's listener, a closed window has none. */
    const listeners = yield* Ref.make(0);
    /** What the quit under way waits for; a new quit replaces it. */
    const answer = yield* Ref.make(yield* Deferred.make<void>());

    const quitting = Stream.unwrap(
      Effect.gen(function* () {
        const subscription = yield* PubSub.subscribe(requests);
        yield* Effect.acquireRelease(Ref.update(listeners, (count) => count + 1), () => Ref.update(listeners, (count) => count - 1));
        return Stream.fromSubscription(subscription);
      }),
    );

    const beforeQuit = Effect.gen(function* () {
      if ((yield* Ref.get(listeners)) === 0) return;
      const waiting = yield* Deferred.make<void>();
      yield* Ref.set(answer, waiting);
      yield* PubSub.publish(requests, 'Quitting');
      yield* Deferred.await(waiting).pipe(Effect.timeoutOption(QUIT_WAIT_MS));
    });

    return QuitGate.of({
      quitting,
      saved: Effect.flatMap(Ref.get(answer), (waiting) => Deferred.succeed(waiting, undefined)),
      beforeQuit: Effect.withSpan(beforeQuit, 'QuitGate.beforeQuit'),
    });
  }),
);
