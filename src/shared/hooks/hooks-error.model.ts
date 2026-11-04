import { Schema } from 'effect';

/**
 * Why a Hook could not be activated or deactivated. `ProviderNotEnabled` and `ProviderHasNoHook` are the user's to fix
 * in Settings; `ConfigUnreadable` means the Provider's own config is not valid JSON, so Timmy refuses to rewrite it.
 */
export class HooksError extends Schema.TaggedError<HooksError>()('HooksError', {
  reason: Schema.Literals(['ProviderNotEnabled', 'ProviderHasNoHook', 'ConfigUnreadable']),
  detail: Schema.String,
}) {}
