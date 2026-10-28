import { Schema } from 'effect';

/**
 * Typed failure for the renderer ⇄ main boundary.
 *
 * `detail` is used instead of `message` on purpose: a `message` field shadows
 * the non-enumerable `Error.prototype.message`, which hides it from
 * `Equal`/`Hash` and makes distinct failures compare equal.
 */
export class DesktopBridgeError extends Schema.TaggedError<DesktopBridgeError>()('DesktopBridgeError', {
  reason: Schema.Literals(['NotInElectron', 'ConnectTimeout']),
  detail: Schema.String,
}) {}
