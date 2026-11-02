import { Context, Effect, Scope, Stream } from 'effect';
import type { AgentOutcome } from '../../src/shared/chat/agent.model';
import { ChatError } from '../../src/shared/chat/chat-error.model';
import type { Usage } from '../../src/shared/chat/usage.model';

/** A model the user has configured in OpenCode. `id` is `vendor/model`. */
export interface OpenCodeModel {
  readonly id: string;
  /** The names of the variants OpenCode offers for this model (its reasoning levels); empty when it has none. */
  readonly variants: ReadonlyArray<string>;
  /** The model's context window in tokens, when OpenCode reports it. */
  readonly contextWindow?: number;
  /** OpenCode lists `image` among the model's input modalities. Absent means unknown, which counts as no. */
  readonly images?: boolean;
}

/** An image sent along with a prompt: its type and raw bytes. */
export interface OpenCodeImage {
  readonly mediaType: string;
  readonly bytes: Uint8Array;
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

/** A slash command OpenCode offers: built-in, or defined by the user or the project. */
export interface OpenCodeCommand {
  readonly name: string;
  readonly description?: string;
}

/** One question of a form the agent shows the user. A field that is not a choice cannot be asked and is never mapped. */
export interface OpenCodeQuestion {
  readonly key: string;
  readonly header?: string;
  readonly prompt: string;
  readonly options: ReadonlyArray<{ readonly value: string; readonly label: string; readonly description?: string }>;
  readonly multiple: boolean;
  readonly custom: boolean;
}

/** The user's answer to one question: the chosen option values and/or free text. */
export interface OpenCodeAnswer {
  readonly key: string;
  /** The question allows several choices, so the answer is always a list. */
  readonly multiple: boolean;
  readonly selected: ReadonlyArray<string>;
  readonly custom?: string;
}

/** What one OpenCode Turn reports, reduced to what Timmy maps. `Idle` and `Failed` end the Turn. */
export type OpenCodeEvent =
  | { readonly _tag: 'TextDelta'; readonly text: string; readonly agent?: string }
  | { readonly _tag: 'ReasoningDelta'; readonly text: string; readonly agent?: string }
  | { readonly _tag: 'Tool'; readonly tool: OpenCodeTool; readonly agent?: string }
  /** A child session started through the task tool. `id` is the child session's id; `parentId` the session that started it (absent: the root). */
  | { readonly _tag: 'AgentStarted'; readonly id: string; readonly parentId?: string; readonly name: string; readonly task?: string }
  | { readonly _tag: 'AgentEnded'; readonly id: string; readonly outcome: AgentOutcome; readonly detail?: string }
  /** What one model step of the session (`agent` absent) or of a child cost. Steps add up. */
  | { readonly _tag: 'StepEnded'; readonly agent?: string; readonly usage: Usage }
  | {
      /** The agent waits for the user. `toolCallId` names the tool call it is about, when OpenCode says. */
      readonly _tag: 'PermissionAsked';
      readonly id: string;
      readonly action: string;
      readonly resources: ReadonlyArray<string>;
      readonly toolCallId?: string;
      /** The child session that asks; absent means the root session. */
      readonly agent?: string;
    }
  | { readonly _tag: 'PermissionReplied'; readonly id: string; readonly reply: PermissionReply }
  /** The agent asks the user questions through a form and waits. `agent` is the child session that asks; absent: the root. */
  | { readonly _tag: 'QuestionAsked'; readonly id: string; readonly questions: ReadonlyArray<OpenCodeQuestion>; readonly agent?: string }
  /** The form is over: answered, or cancelled by whoever. */
  | { readonly _tag: 'QuestionClosed'; readonly id: string; readonly answered: boolean }
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
  /** Slash commands (built-in and the project's own) for `cwd`. No session is needed. */
  readonly commands: (options: { readonly cwd: string }) => Effect.Effect<ReadonlyArray<OpenCodeCommand>, ChatError>;
  /**
   * Brings a stored OpenCode session back under the given settings: fails with `SessionNotFound` when the
   * server does not know it, otherwise replaces its permission rules and model. Its history stays.
   */
  readonly resumeSession: (options: {
    readonly sessionId: string;
    readonly model?: string;
    readonly variant?: string;
    readonly permissions: ReadonlyArray<OpenCodePermissionRule>;
  }) => Effect.Effect<void, ChatError>;
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
    readonly images?: ReadonlyArray<OpenCodeImage>;
    /** Run this slash command (with `text` as its arguments) instead of sending `text` as a prompt. */
    readonly command?: string;
  }) => Stream.Stream<OpenCodeEvent>;
  /** Answers a `PermissionAsked`. OpenCode then reports `PermissionReplied` on the Turn's stream. */
  readonly replyPermission: (options: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly reply: PermissionReply;
  }) => Effect.Effect<void>;
  /** Answers a `QuestionAsked`; `undefined` cancels it. OpenCode then reports `QuestionClosed` on the Turn's stream. */
  readonly replyQuestion: (options: {
    readonly sessionId: string;
    readonly requestId: string;
    readonly answers: ReadonlyArray<OpenCodeAnswer> | undefined;
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
