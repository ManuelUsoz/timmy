import { Cause } from 'effect';

/**
 * Text for a failure shown to the user. Typed errors carry `reason` + `detail` and no `message`, so
 * `Cause.pretty` alone prints a bare stack; this puts the fields first.
 */
export const describeCause = (cause: Cause.Cause<unknown>): string => {
  const typed = cause.reasons
    .filter(Cause.isFailReason)
    .map(({ error }) => error)
    .flatMap((error) =>
      // eslint-disable-next-line no-restricted-syntax -- formats any Cause for display; the error type is unknown here
      typeof error === 'object' && error !== null && '_tag' in error && 'detail' in error
        ? [`${String(error._tag)}${'reason' in error ? ` (${String(error.reason)})` : ''}: ${String(error.detail)}`]
        : [],
    );
  return typed.length > 0 ? typed.join('\n') : Cause.pretty(cause);
};
