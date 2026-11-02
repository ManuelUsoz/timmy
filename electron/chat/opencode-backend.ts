import { Context, Effect, Scope, Stream } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';

/** A model the user has configured in OpenCode. `id` is `vendor/model`. */
export interface OpenCodeModel {
  readonly id: string;
}

/** What one OpenCode Turn reports, reduced to what Timmy maps. `Idle` ends the Turn. */
export type OpenCodeEvent =
  | { readonly _tag: 'TextDelta'; readonly text: string }
  | { readonly _tag: 'Failed'; readonly detail: string }
  | { readonly _tag: 'Idle' };

/** A running OpenCode server, as the Adapter uses it. Failures the user can act on are `ChatError`s; the rest are defects. */
export interface OpenCodeClient {
  readonly models: Effect.Effect<ReadonlyArray<OpenCodeModel>, ChatError>;
  /** Opens an OpenCode session working in `cwd`; returns the id OpenCode knows it by. */
  readonly createSession: (options: { readonly cwd: string; readonly model?: string }) => Effect.Effect<string, ChatError>;
  /** Subscribes to the session's events, then sends the prompt. The stream ends after `Idle`. */
  readonly turn: (options: {
    readonly sessionId: string;
    readonly cwd: string;
    readonly text: string;
  }) => Stream.Stream<OpenCodeEvent>;
  readonly interrupt: (sessionId: string) => Effect.Effect<void>;
}

/**
 * The only door to the `opencode` binary. `launch` fails with `ProviderNotInstalled` when the binary is
 * missing, otherwise starts one local server (127.0.0.1, random port, generated password) that lives as
 * long as the given scope.
 */
export class OpenCodeBackend extends Context.Service<
  OpenCodeBackend,
  { readonly launch: Effect.Effect<OpenCodeClient, ChatError, Scope.Scope> }
>()('chat/OpenCodeBackend') {}
