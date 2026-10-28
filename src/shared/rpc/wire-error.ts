import { Cause, Effect } from 'effect';

/**
 * Pattern for errors that cross the wire (declare them next to their RPC):
 *
 *   export class NotesError extends Schema.TaggedError<NotesError>()('NotesError', {
 *     reason: Schema.Literals(['NotFound', 'Conflict']),
 *     detail: Schema.String,
 *   }) {}
 *
 * Serializable fields only: no `cause`, no field named `message`. Reference the
 * class in the Rpc's `error:` option so clients can match it with `catchTag`.
 */

/**
 * Service-boundary helper: turns a non-actionable failure into a defect, with
 * the pretty-printed cause as its text, so it never leaks into the typed channel.
 */
export const toWireDefect = <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, never, R> =>
  effect.pipe(Effect.catchCause((cause) => Effect.die(Cause.pretty(cause))));
