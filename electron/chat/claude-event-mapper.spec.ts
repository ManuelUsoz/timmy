import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { describe, expect, it } from '@effect/vitest';
import { ChatEvent } from '../../src/shared/chat/event.model';
import { SessionId, TurnId } from '../../src/shared/chat/ids.model';
import { initialMapperState, MapContext, mapSdkMessage, MapperState } from './claude-event-mapper';

const ctx: MapContext = { sessionId: SessionId.make('s1'), turnId: TurnId.make('t1'), interrupted: false };

/** Fixtures are partial SDK messages; the mapper reads only the fields set here. */
const sdk = (message: object): SDKMessage => message as unknown as SDKMessage;

const run = (messages: ReadonlyArray<SDKMessage>, context: MapContext = ctx) =>
  messages.reduce<{ events: ReadonlyArray<ChatEvent>; state: MapperState }>(
    (acc, message) => {
      const [events, state] = mapSdkMessage(acc.state, message, context);
      return { events: [...acc.events, ...events], state };
    },
    { events: [], state: initialMapperState },
  );

const tags = (events: ReadonlyArray<ChatEvent>) => events.map((e) => e._tag);

const init = sdk({ type: 'system', subtype: 'init', model: 'claude-test' });

const assistant = (id: string, content: ReadonlyArray<object>, parent: string | null = null, usage = {}) =>
  sdk({
    type: 'assistant',
    parent_tool_use_id: parent,
    message: { id, content, usage: { input_tokens: 10, output_tokens: 5, ...usage } },
  });

const toolResult = (toolUseId: string, content: unknown, extra: object = {}) =>
  sdk({
    type: 'user',
    parent_tool_use_id: null,
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUseId, content }] },
    ...extra,
  });

const modelUsage = (input: number, output: number, cost: number) => ({
  'claude-test': {
    inputTokens: input,
    outputTokens: output,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    webSearchRequests: 0,
    costUSD: cost,
    contextWindow: 200_000,
    maxOutputTokens: 8_000,
  },
});

const result = (input: number, output: number, cost: number, extra: object = {}) =>
  sdk({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 1200,
    total_cost_usd: cost,
    modelUsage: modelUsage(input, output, cost),
    result: 'ok',
    ...extra,
  });

describe('claude-event-mapper', () => {
  it('announces the session and root agent once', () => {
    const { events } = run([init, init]);
    expect(tags(events)).toEqual(['SessionStarted', 'AgentSpawned']);
  });

  it('streams text and thinking deltas without repeating them from the complete message', () => {
    const { events } = run([
      sdk({ type: 'stream_event', parent_tool_use_id: null, event: { type: 'message_start', message: { id: 'm1' } } }),
      sdk({
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } },
      }),
      sdk({
        type: 'stream_event',
        parent_tool_use_id: null,
        event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
      }),
      assistant('m1', [{ type: 'text', text: 'Hi' }]),
    ]);
    const deltas = events.flatMap((e) => (e._tag === 'MessageDelta' ? [[e.channel, e.text] as const] : []));
    expect(deltas).toEqual([
      ['Thinking', 'hmm'],
      ['Text', 'Hi'],
    ]);
  });

  it('emits text of a message that never streamed', () => {
    const { events } = run([assistant('m1', [{ type: 'text', text: 'whole' }])]);
    expect(events.some((e) => e._tag === 'MessageDelta' && e.text === 'whole')).toBe(true);
  });

  it('turns an Edit tool_use into a call with location and diff, then completes it', () => {
    const { events } = run([
      assistant('m1', [
        { type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: 'src/a.ts', old_string: 'a', new_string: 'b' } },
      ]),
      toolResult('tu1', [{ type: 'text', text: 'edited' }]),
    ]);
    const started = events.find((e) => e._tag === 'ToolCallStarted');
    expect(started?._tag === 'ToolCallStarted' && started.call).toMatchObject({
      kind: 'Edit',
      title: 'Edit src/a.ts',
      locations: [{ path: 'src/a.ts' }],
      diffs: [{ path: 'src/a.ts', oldText: 'a', newText: 'b' }],
    });
    const updated = events.find((e) => e._tag === 'ToolCallUpdated');
    expect(updated?._tag === 'ToolCallUpdated' && updated.call).toMatchObject({ status: 'Completed', output: 'edited' });
  });

  it('marks a failed tool result as Failed', () => {
    const { events } = run([
      assistant('m1', [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'false' } }]),
      sdk({
        type: 'user',
        parent_tool_use_id: null,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'boom', is_error: true }] },
      }),
    ]);
    const updated = events.find((e) => e._tag === 'ToolCallUpdated');
    expect(updated?._tag === 'ToolCallUpdated' && updated.call.status).toBe('Failed');
  });

  it('spawns a subagent from the Agent tool and attributes its messages to it', () => {
    const { events } = run([
      assistant('m1', [
        { type: 'tool_use', id: 'agent1', name: 'Agent', input: { description: 'find usages', subagent_type: 'Explore', prompt: 'x' } },
      ]),
      assistant('m2', [{ type: 'tool_use', id: 'tu2', name: 'Read', input: { file_path: 'a.ts' } }], 'agent1', {
        input_tokens: 100,
        output_tokens: 7,
      }),
      toolResult('agent1', 'done'),
    ]);
    const spawned = events.find((e) => e._tag === 'AgentSpawned');
    expect(spawned?._tag === 'AgentSpawned' && spawned.agent).toMatchObject({
      id: 'agent1',
      parentId: 'root',
      name: 'Explore',
      task: 'find usages',
    });
    const call = events.find((e) => e._tag === 'ToolCallStarted');
    expect(call?._tag === 'ToolCallStarted' && call.call.agentId).toBe('agent1');
    const finished = events.find((e) => e._tag === 'AgentFinished');
    expect(finished?._tag === 'AgentFinished' && finished).toMatchObject({
      agentId: 'agent1',
      outcome: 'Completed',
      usage: { inputTokens: 100, outputTokens: 7 },
    });
    // The Agent call itself is an agent, not a tool call.
    expect(events.filter((e) => e._tag === 'ToolCallStarted')).toHaveLength(1);
  });

  it('keeps a background subagent running until its task_notification', () => {
    const { events } = run([
      assistant('m1', [{ type: 'tool_use', id: 'agent1', name: 'Agent', input: { description: 'bg', prompt: 'x' } }]),
      toolResult('agent1', 'launched', { tool_use_result: { status: 'async_launched' } }),
      sdk({ type: 'system', subtype: 'task_notification', tool_use_id: 'agent1', status: 'failed' }),
      sdk({ type: 'system', subtype: 'task_notification', tool_use_id: 'agent1', status: 'completed' }),
    ]);
    const finished = events.filter((e) => e._tag === 'AgentFinished');
    expect(finished).toHaveLength(1);
    expect(finished[0]?._tag === 'AgentFinished' && finished[0].outcome).toBe('Failed');
  });

  it('reports per-agent usage without double counting a re-sent message', () => {
    const { events } = run([
      assistant('m1', [{ type: 'text', text: 'a' }]),
      assistant('m1', [{ type: 'text', text: 'b' }]),
    ]);
    const usages = events.flatMap((e) => (e._tag === 'UsageUpdated' ? [e.usage.inputTokens] : []));
    expect(usages).toEqual([10, 10]);
  });

  it('finishes a turn with the usage delta of the session-cumulative totals', () => {
    const { events } = run([result(100, 20, 0.5), result(150, 50, 0.8)]);
    const finished = events.flatMap((e) => (e._tag === 'TurnFinished' ? [e] : []));
    expect(finished[0]).toMatchObject({ outcome: 'Completed', usage: { inputTokens: 100, outputTokens: 20, costUsd: 0.5 } });
    expect(finished[1]?.usage.inputTokens).toBe(50);
    expect(finished[1]?.usage.outputTokens).toBe(30);
    expect(finished[1]?.usage.costUsd).toBeCloseTo(0.3);
    const session = events.find((e) => e._tag === 'UsageUpdated' && e.agentId === undefined);
    expect(session?._tag === 'UsageUpdated' && session.context).toEqual({ usedTokens: 0, maxTokens: 200_000 });
  });

  it('maps interrupted, max-turns and error results', () => {
    const outcome = (message: SDKMessage, context: MapContext = ctx) => {
      const turn = run([message], context).events.find((e) => e._tag === 'TurnFinished');
      return turn?._tag === 'TurnFinished' ? turn : undefined;
    };
    expect(outcome(result(1, 1, 0), { ...ctx, interrupted: true })?.outcome).toBe('Cancelled');
    expect(outcome(result(1, 1, 0, { subtype: 'error_max_turns', errors: [] }))?.outcome).toBe('MaxTurns');
    expect(outcome(result(1, 1, 0, { subtype: 'error_during_execution', is_error: true, errors: ['bad'] }))).toMatchObject({
      outcome: 'Failed',
      detail: 'bad',
    });
  });

  it('ignores messages with no UI meaning', () => {
    expect(run([sdk({ type: 'system', subtype: 'status' }), sdk({ type: 'rate_limit_event' })]).events).toEqual([]);
  });
});
