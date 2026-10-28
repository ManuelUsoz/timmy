import type { ModelUsage, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { AgentId, MessageId, SessionId, ToolCallId, TurnId } from '../../src/shared/chat/ids.model';
import { AgentInfo, AgentOutcome } from '../../src/shared/chat/agent.model';
import { FileDiff, FileLocation, ToolCall, ToolKind } from '../../src/shared/chat/tool-call.model';
import { ContextWindow, Usage } from '../../src/shared/chat/usage.model';

/**
 * Pure translation of Claude Agent SDK messages into `ChatEvent`s.
 *
 * Subagents: the SDK tags every message of a subagent with `parent_tool_use_id`,
 * the id of the `Agent`/`Task` tool call that spawned it. That id becomes the
 * subagent's `AgentId`; messages without it belong to `rootAgentId`.
 *
 * Text and thinking stream through `stream_event` deltas (the adapter sets
 * `includePartialMessages`); the complete `assistant` message only supplies tool
 * calls, usage, and text of messages that never streamed.
 */

export const rootAgentId = AgentId.make('root');

const SUBAGENT_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task']);
const QUESTION_TOOL = 'AskUserQuestion';
const MAX_OUTPUT_CHARS = 20_000;

export const zeroUsage: Usage = { inputTokens: 0, outputTokens: 0 };

interface AgentRecord {
  /** Launched in the background: the first tool_result is only a receipt. */
  readonly background: boolean;
  readonly finished: boolean;
}

interface MessageUsage {
  readonly agentId: AgentId;
  readonly usage: Usage;
}

export interface MapperState {
  readonly initialized: boolean;
  /** Subagents by the tool_use id that spawned them. */
  readonly agents: ReadonlyMap<string, AgentRecord>;
  readonly toolCalls: ReadonlyMap<string, ToolCall>;
  /** Message ids whose text already went out as deltas. */
  readonly streamedMessages: ReadonlySet<string>;
  /** Message id being streamed, per agent (key: parent_tool_use_id or ''). */
  readonly streamingMessage: ReadonlyMap<string, string>;
  /** Last reported usage per message id; deduplicates a message the SDK re-sends per block. */
  readonly messageUsage: ReadonlyMap<string, MessageUsage>;
  /** Session-cumulative usage as of the last `result`; turn usage is the delta. */
  readonly cumulative: Usage;
  readonly rootContextTokens: number;
}

export const initialMapperState: MapperState = {
  initialized: false,
  agents: new Map(),
  toolCalls: new Map(),
  streamedMessages: new Set(),
  streamingMessage: new Map(),
  messageUsage: new Map(),
  cumulative: zeroUsage,
  rootContextTokens: 0,
};

export interface MapContext {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  /** The user interrupted this turn; a `result` that follows is reported as Cancelled. */
  readonly interrupted: boolean;
}

export type MapResult = readonly [events: ReadonlyArray<ChatEvent>, state: MapperState];

// ------------------------------------------------------------------- usage

const addOptional = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined && b === undefined ? undefined : (a ?? 0) + (b ?? 0);

const withOptional = <K extends string>(key: K, value: number | undefined) =>
  value === undefined ? {} : ({ [key]: value } as { [P in K]: number });

export const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  ...withOptional('cacheReadTokens', addOptional(a.cacheReadTokens, b.cacheReadTokens)),
  ...withOptional('cacheWriteTokens', addOptional(a.cacheWriteTokens, b.cacheWriteTokens)),
  ...withOptional('reasoningTokens', addOptional(a.reasoningTokens, b.reasoningTokens)),
  ...withOptional('costUsd', addOptional(a.costUsd, b.costUsd)),
  ...withOptional('durationMs', addOptional(a.durationMs, b.durationMs)),
});

const subtractOptional = (a: number | undefined, b: number | undefined): number | undefined =>
  a === undefined ? undefined : Math.max(0, a - (b ?? 0));

/** `current - previous`, never negative (a `/clear` or resume can reset the SDK's totals). */
export const subtractUsage = (current: Usage, previous: Usage): Usage => ({
  inputTokens: Math.max(0, current.inputTokens - previous.inputTokens),
  outputTokens: Math.max(0, current.outputTokens - previous.outputTokens),
  ...withOptional('cacheReadTokens', subtractOptional(current.cacheReadTokens, previous.cacheReadTokens)),
  ...withOptional('cacheWriteTokens', subtractOptional(current.cacheWriteTokens, previous.cacheWriteTokens)),
  ...withOptional('reasoningTokens', subtractOptional(current.reasoningTokens, previous.reasoningTokens)),
  ...withOptional('costUsd', subtractOptional(current.costUsd, previous.costUsd)),
});

const sumModelUsage = (modelUsage: Readonly<Record<string, ModelUsage>>): Usage =>
  Object.values(modelUsage).reduce<Usage>(
    (total, m) =>
      addUsage(total, {
        inputTokens: m.inputTokens,
        outputTokens: m.outputTokens,
        cacheReadTokens: m.cacheReadInputTokens,
        cacheWriteTokens: m.cacheCreationInputTokens,
        ...withOptional('reasoningTokens', m.thinkingTokens),
        costUsd: m.costUSD,
      }),
    zeroUsage,
  );

interface RawUsage {
  readonly input_tokens?: number | null;
  readonly output_tokens?: number | null;
  readonly cache_read_input_tokens?: number | null;
  readonly cache_creation_input_tokens?: number | null;
}

const toUsage = (raw: RawUsage | undefined): Usage => ({
  inputTokens: raw?.input_tokens ?? 0,
  outputTokens: raw?.output_tokens ?? 0,
  ...withOptional('cacheReadTokens', raw?.cache_read_input_tokens ?? undefined),
  ...withOptional('cacheWriteTokens', raw?.cache_creation_input_tokens ?? undefined),
});

const agentUsage = (state: MapperState, agentId: AgentId): Usage =>
  [...state.messageUsage.values()]
    .filter((m) => m.agentId === agentId)
    .reduce<Usage>((total, m) => addUsage(total, m.usage), zeroUsage);

// -------------------------------------------------------------- tool calls

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const TOOL_KINDS: Readonly<Record<string, ToolKind>> = {
  Read: 'Read',
  Edit: 'Edit',
  MultiEdit: 'Edit',
  NotebookEdit: 'Edit',
  Write: 'Write',
  Glob: 'Search',
  Grep: 'Search',
  Bash: 'Execute',
  BashOutput: 'Execute',
  KillShell: 'Execute',
  WebFetch: 'Fetch',
  WebSearch: 'Fetch',
  TodoWrite: 'Think',
};

const toolKind = (name: string): ToolKind => TOOL_KINDS[name] ?? 'Other';

const toolPath = (input: Readonly<Record<string, unknown>>): string | undefined =>
  str(input['file_path']) ?? str(input['notebook_path']) ?? str(input['path']);

const toolDiffs = (name: string, input: Readonly<Record<string, unknown>>): ReadonlyArray<FileDiff> => {
  const path = str(input['file_path']);
  if (path === undefined) return [];
  if (name === 'Edit') {
    return [{ path, oldText: str(input['old_string']) ?? '', newText: str(input['new_string']) ?? '' }];
  }
  if (name === 'Write') return [{ path, newText: str(input['content']) ?? '' }];
  if (name === 'MultiEdit' && Array.isArray(input['edits'])) {
    return input['edits'].flatMap((edit: unknown): ReadonlyArray<FileDiff> => {
      if (typeof edit !== 'object' || edit === null) return [];
      const fields: Readonly<Record<string, unknown>> = { ...edit };
      return [{ path, oldText: str(fields['old_string']) ?? '', newText: str(fields['new_string']) ?? '' }];
    });
  }
  return [];
};

const firstLine = (text: string): string => {
  const line = text.split('\n', 1)[0] ?? '';
  return line.length > 80 ? `${line.slice(0, 77)}...` : line;
};

const toolTitle = (name: string, input: Readonly<Record<string, unknown>>): string => {
  const detail =
    str(input['description']) ??
    toolPath(input) ??
    str(input['command']) ??
    str(input['pattern']) ??
    str(input['url']) ??
    str(input['query']);
  return detail === undefined ? name : `${name} ${firstLine(detail)}`;
};

/** Builds the UI-facing `ToolCall` from a tool name and its raw input. */
export const describeToolCall = (
  id: string,
  agentId: AgentId,
  name: string,
  input: Readonly<Record<string, unknown>>,
  status: ToolCall['status'] = 'Pending',
): ToolCall => {
  const path = toolPath(input);
  const offset = input['offset'];
  const line = typeof offset === 'number' && Number.isInteger(offset) && offset >= 1 ? offset : undefined;
  const locations: ReadonlyArray<FileLocation> =
    path === undefined ? [] : [{ path, ...withOptional('line', line) }];
  return {
    id: ToolCallId.make(id),
    agentId,
    name,
    kind: toolKind(name),
    title: toolTitle(name, input),
    status,
    locations,
    diffs: toolDiffs(name, input),
  };
};

const resultText = (content: unknown): string | undefined => {
  if (typeof content === 'string') return content.slice(0, MAX_OUTPUT_CHARS);
  if (!Array.isArray(content)) return undefined;
  const text = content
    .flatMap((block: unknown) =>
      typeof block === 'object' && block !== null && 'text' in block && typeof block.text === 'string'
        ? [block.text]
        : [],
    )
    .join('\n');
  return text === '' ? undefined : text.slice(0, MAX_OUTPUT_CHARS);
};

// ------------------------------------------------------------------ mapping

const agentOf = (parentToolUseId: string | null): AgentId =>
  parentToolUseId === null ? rootAgentId : AgentId.make(parentToolUseId);

const withEntry = <V>(map: ReadonlyMap<string, V>, key: string, value: V): ReadonlyMap<string, V> =>
  new Map(map).set(key, value);

const finishAgent = (
  state: MapperState,
  ctx: MapContext,
  toolUseId: string,
  outcome: AgentOutcome,
): MapResult => {
  const record = state.agents.get(toolUseId);
  if (record === undefined || record.finished) return [[], state];
  const agentId = AgentId.make(toolUseId);
  const usage = agentUsage(state, agentId);
  return [
    [{ _tag: 'AgentFinished', sessionId: ctx.sessionId, agentId, outcome, usage }],
    { ...state, agents: withEntry(state.agents, toolUseId, { ...record, finished: true }) },
  ];
};

const mapAssistant = (
  state: MapperState,
  ctx: MapContext,
  msg: Extract<SDKMessage, { type: 'assistant' }>,
): MapResult => {
  const agentId = agentOf(msg.parent_tool_use_id);
  const messageId = msg.message.id;
  const streamed = state.streamedMessages.has(messageId);
  const events: ChatEvent[] = [];
  let agents = state.agents;
  let toolCalls = state.toolCalls;

  for (const block of msg.message.content) {
    if (!streamed && block.type === 'text' && block.text !== '') {
      events.push({
        _tag: 'MessageDelta',
        sessionId: ctx.sessionId,
        agentId,
        messageId: MessageId.make(messageId),
        channel: 'Text',
        text: block.text,
      });
    } else if (!streamed && block.type === 'thinking' && block.thinking !== '') {
      events.push({
        _tag: 'MessageDelta',
        sessionId: ctx.sessionId,
        agentId,
        messageId: MessageId.make(messageId),
        channel: 'Thinking',
        text: block.thinking,
      });
    } else if (block.type === 'tool_use') {
      const input: Readonly<Record<string, unknown>> =
        typeof block.input === 'object' && block.input !== null ? { ...block.input } : {};
      if (SUBAGENT_TOOLS.has(block.name)) {
        const agent: AgentInfo = {
          id: AgentId.make(block.id),
          parentId: agentId,
          name: str(input['subagent_type']) ?? 'agent',
          ...withText('task', str(input['description'])),
        };
        agents = withEntry(agents, block.id, { background: input['run_in_background'] === true, finished: false });
        events.push({ _tag: 'AgentSpawned', sessionId: ctx.sessionId, agent });
      } else if (block.name !== QUESTION_TOOL) {
        const call = describeToolCall(block.id, agentId, block.name, input);
        toolCalls = withEntry(toolCalls, block.id, call);
        events.push({ _tag: 'ToolCallStarted', sessionId: ctx.sessionId, call });
      }
    }
  }

  const messageUsage = withEntry(state.messageUsage, messageId, { agentId, usage: toUsage(msg.message.usage) });
  const next: MapperState = {
    ...state,
    agents,
    toolCalls,
    messageUsage,
    rootContextTokens:
      agentId === rootAgentId ? contextTokens(msg.message.usage) : state.rootContextTokens,
  };
  events.push({
    _tag: 'UsageUpdated',
    sessionId: ctx.sessionId,
    agentId,
    usage: agentUsage(next, agentId),
  });
  return [events, next];
};

const withText = <K extends string>(key: K, value: string | undefined) =>
  value === undefined ? {} : ({ [key]: value } as { [P in K]: string });

const contextTokens = (raw: RawUsage | undefined): number =>
  (raw?.input_tokens ?? 0) + (raw?.cache_read_input_tokens ?? 0) + (raw?.cache_creation_input_tokens ?? 0);

const mapUser = (
  state: MapperState,
  ctx: MapContext,
  msg: Extract<SDKMessage, { type: 'user' }>,
): MapResult => {
  const content = msg.message.content;
  if (typeof content === 'string') return [[], state];
  const toolUseResult: unknown = msg.tool_use_result;
  const asyncLaunched =
    typeof toolUseResult === 'object' &&
    toolUseResult !== null &&
    'status' in toolUseResult &&
    toolUseResult.status === 'async_launched';
  let current = state;
  const events: ChatEvent[] = [];
  for (const block of content) {
    if (block.type !== 'tool_result') continue;
    const failed = block.is_error === true;
    const agent = current.agents.get(block.tool_use_id);
    if (agent !== undefined) {
      if (!agent.background && !asyncLaunched) {
        const [finished, next] = finishAgent(current, ctx, block.tool_use_id, failed ? 'Failed' : 'Completed');
        events.push(...finished);
        current = next;
      }
      continue;
    }
    const call = current.toolCalls.get(block.tool_use_id);
    if (call === undefined) continue;
    const output = resultText(block.content);
    const updated: ToolCall = {
      ...call,
      status: failed ? 'Failed' : 'Completed',
      ...withText('output', output),
    };
    current = { ...current, toolCalls: withEntry(current.toolCalls, block.tool_use_id, updated) };
    events.push({ _tag: 'ToolCallUpdated', sessionId: ctx.sessionId, call: updated });
  }
  return [events, current];
};

const mapStreamEvent = (
  state: MapperState,
  ctx: MapContext,
  msg: Extract<SDKMessage, { type: 'stream_event' }>,
): MapResult => {
  const key = msg.parent_tool_use_id ?? '';
  const event = msg.event;
  if (event.type === 'message_start') {
    return [[], { ...state, streamingMessage: withEntry(state.streamingMessage, key, event.message.id) }];
  }
  if (event.type !== 'content_block_delta') return [[], state];
  const messageId = state.streamingMessage.get(key);
  if (messageId === undefined) return [[], state];
  const delta = event.delta;
  const [channel, text] =
    delta.type === 'text_delta'
      ? (['Text', delta.text] as const)
      : delta.type === 'thinking_delta'
        ? (['Thinking', delta.thinking] as const)
        : ([undefined, ''] as const);
  if (channel === undefined || text === '') return [[], state];
  return [
    [
      {
        _tag: 'MessageDelta',
        sessionId: ctx.sessionId,
        agentId: agentOf(msg.parent_tool_use_id),
        messageId: MessageId.make(messageId),
        channel,
        text,
      },
    ],
    { ...state, streamedMessages: new Set(state.streamedMessages).add(messageId) },
  ];
};

const mapResult = (
  state: MapperState,
  ctx: MapContext,
  msg: Extract<SDKMessage, { type: 'result' }>,
): MapResult => {
  const cumulative = { ...sumModelUsage(msg.modelUsage), costUsd: msg.total_cost_usd };
  const turnUsage: Usage = { ...subtractUsage(cumulative, state.cumulative), durationMs: msg.duration_ms };
  const maxTokens = Math.max(0, ...Object.values(msg.modelUsage).map((m) => m.contextWindow));
  const context: ContextWindow | undefined =
    maxTokens > 0 ? { usedTokens: state.rootContextTokens, maxTokens } : undefined;
  const outcome =
    ctx.interrupted
      ? 'Cancelled'
      : msg.subtype === 'success' && !msg.is_error
        ? 'Completed'
        : msg.subtype === 'error_max_turns'
          ? 'MaxTurns'
          : 'Failed';
  const detail =
    outcome === 'Failed'
      ? msg.subtype === 'success'
        ? msg.result
        : (msg.errors?.join('\n') ?? msg.subtype)
      : undefined;
  return [
    [
      {
        _tag: 'UsageUpdated',
        sessionId: ctx.sessionId,
        usage: cumulative,
        ...(context === undefined ? {} : { context }),
      },
      {
        _tag: 'TurnFinished',
        sessionId: ctx.sessionId,
        turnId: ctx.turnId,
        outcome,
        ...withText('detail', detail),
        usage: turnUsage,
      },
    ],
    { ...state, cumulative },
  ];
};

/** Translates one SDK message. Messages with no UI meaning (hooks, status, ...) yield no events. */
export const mapSdkMessage = (state: MapperState, msg: SDKMessage, ctx: MapContext): MapResult => {
  switch (msg.type) {
    case 'system': {
      if (msg.subtype === 'init' && !state.initialized) {
        return [
          [
            { _tag: 'SessionStarted', sessionId: ctx.sessionId, provider: 'Claude', model: msg.model },
            {
              _tag: 'AgentSpawned',
              sessionId: ctx.sessionId,
              agent: { id: rootAgentId, name: 'Claude' },
            },
          ],
          { ...state, initialized: true },
        ];
      }
      if (msg.subtype === 'task_notification' && msg.tool_use_id !== undefined) {
        const outcome: AgentOutcome =
          msg.status === 'completed' ? 'Completed' : msg.status === 'failed' ? 'Failed' : 'Cancelled';
        return finishAgent(state, ctx, msg.tool_use_id, outcome);
      }
      return [[], state];
    }
    case 'stream_event':
      return mapStreamEvent(state, ctx, msg);
    case 'assistant':
      return mapAssistant(state, ctx, msg);
    case 'user':
      return mapUser(state, ctx, msg);
    case 'result':
      return mapResult(state, ctx, msg);
    default:
      return [[], state];
  }
};
