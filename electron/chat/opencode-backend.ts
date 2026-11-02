import { Context, Effect, Scope, Stream } from 'effect';
import { ChatError } from '../../src/shared/chat/chat-error.model';

/** A model the user has configured in OpenCode. `id` is `vendor/model`. */
export interface OpenCodeModel {
  readonly id: string;
  /** The names of the variants OpenCode offers for this model (its reasoning levels); empty when it has none. */
  readonly variants: ReadonlyArray<string>;
}

/** Where a tool call is in OpenCode's own lifecycle. */
export type OpenCodeToolStatus = 'Pending' | 'Running' | 'Completed' | 'Failed';

/** A tool call as OpenCode reports it, reduced to what Timmy maps. Every report replaces the previous one of the same `id`. */
export interface OpenCodeTool {
  readonly id: string;
  readonly name: string;
  readonly input: Readonly<Record<string, unknown>>;
  readonly status: OpenCodeToolStatus;
  readonly output?: string;
}

/** What one OpenCode Turn reports, reduced to what Timmy maps. `Idle` and `Failed` end the Turn. */
export type OpenCodeEvent =
  | { readonly _tag: 'TextDelta'; readonly text: string }
  | { readonly _tag: 'Tool'; readonly tool: OpenCodeTool }
  | {
      /** The agent waits for the user. `toolCallId` names the tool call it is about, when OpenCode says. */
      readonly _tag: 'PermissionAsked';
      readonly id: string;
      readonly action: string;
      readonly resources: ReadonlyArray<string>;
      readonly toolCallId?: string;
    }
  | { readonly _tag: 'PermissionReplied'; readonly id: string; readonly reply: PermissionReply }
  | { readonly _tag: 'Failed'; readonly detail: string }
  | { readonly _tag: 'Idle' };

/** Timmy answers an Ask once or not at all. "Always" would write a persistent rule behind the user's back, so it cannot be said. */
export type PermissionReply = 'once' | 'reject';

/** One standing rule for a session: what OpenCode may do on its own (`allow`), must ask about (`ask`) or never does (`deny`). */
export interface OpenCodePermissionRule {
  readonly action: string;
  readonly resource: string;
  readonly effect: 'allow' | 'ask' | 'deny';
}

/** A running OpenCode server, as the Adapter uses it. Failures the user can act on are `ChatError`s; the rest are defects. */
export interface OpenCodeClient {
  readonly models: Effect.Effect<ReadonlyArray<OpenCodeModel>, ChatError>;
  /** Opens an OpenCode session working in `cwd` under `permissions`; returns the id OpenCode knows it by. */
  readonly createSession: (options: {
    readonly cwd: string;
    readonly model?: string;
    /** One of the model's variants; absent means the model's own default. */
    readonly variant?: string;
    readonly permissions: ReadonlyArray<OpenCodePermissionRule>;
  }) => Effect.Effect<string, ChatError>;
  /** Subscribes to the session's events, then sends the prompt. The stream ends after `Idle` or `Failed`. */
  readonly turn: (options: {
    readonly sessionId: string;
    readonly cwd: string;
    readonly text: string;
  }) => Stream.Stream<OpenCodeEvent>;
  /** Answers a `PermissionAsked`. OpenCode then reports `PermissionReplied` on the Turn's stream. */
  readonly replyPermission: (options: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly reply: PermissionReply;
  }) => Effect.Effect<void>;
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
