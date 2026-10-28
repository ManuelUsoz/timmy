import { describe, expect, it } from 'vitest';
import type { ChatEvent } from '../../../shared/chat/event.model';
import { AgentId, MessageId, SessionId, ToolCallId, TurnId } from '../../../shared/chat/ids.model';
import type { ToolCall } from '../../../shared/chat/tool-call.model';
import { addUserMessage, groupByOwner, initialChatState, reduceChat } from './chat-state';

const sessionId = SessionId.make('s');
const agentId = AgentId.make('root');
const messageId = MessageId.make('m1');

const delta = (text: string, channel: 'Text' | 'Thinking' = 'Text', owner = agentId): ChatEvent => ({
  _tag: 'MessageDelta',
  sessionId,
  agentId: owner,
  messageId,
  channel,
  text,
});

const call = (status: ToolCall['status']): ToolCall => ({
  id: ToolCallId.make('t1'),
  agentId,
  name: 'Read',
  kind: 'Read',
  title: 'Read a.ts',
  status,
  locations: [],
  diffs: [],
});

const run = (events: ReadonlyArray<ChatEvent>) => events.reduce(reduceChat, addUserMessage(initialChatState, 'hi'));

describe('reduceChat', () => {
  it('appends deltas of one message into a single assistant item', () => {
    const state = run([delta('Hel'), delta('lo'), delta('hmm', 'Thinking')]);
    expect(state.items).toEqual([
      { kind: 'User', text: 'hi' },
      { kind: 'Assistant', agentId, messageId, text: 'Hello', thinking: 'hmm' },
    ]);
  });

  it('replaces a tool call when it is updated', () => {
    const state = run([
      { _tag: 'ToolCallStarted', sessionId, call: call('Running') },
      { _tag: 'ToolCallUpdated', sessionId, call: { ...call('Completed'), output: 'ok' } },
    ]);
    expect(state.items.filter((i) => i.kind === 'Tool')).toEqual([
      { kind: 'Tool', call: { ...call('Completed'), output: 'ok' } },
    ]);
  });

  it('keeps session usage and context, ignoring per-agent usage', () => {
    const usage = { inputTokens: 10, outputTokens: 5 };
    const state = run([
      { _tag: 'UsageUpdated', sessionId, usage, context: { usedTokens: 10, maxTokens: 200 } },
      { _tag: 'UsageUpdated', sessionId, agentId, usage: { inputTokens: 1, outputTokens: 1 } },
    ]);
    expect(state.usage).toEqual(usage);
    expect(state.context).toEqual({ usedTokens: 10, maxTokens: 200 });
  });
  it('nests the items of a subagent under its spawn and tracks its status and usage', () => {
    const child = AgentId.make('tu-agent');
    const usage = { inputTokens: 3, outputTokens: 4 };
    const state = run([
      { _tag: 'AgentSpawned', sessionId, agent: { id: child, parentId: agentId, name: 'Explore', task: 'look' } },
      delta('from child', 'Text', child),
      { _tag: 'ToolCallStarted', sessionId, call: { ...call('Running'), agentId: child } },
      { _tag: 'UsageUpdated', sessionId, agentId: child, usage },
      { _tag: 'AgentFinished', sessionId, agentId: child, outcome: 'Completed' },
    ]);
    const groups = groupByOwner(state);
    expect(groups.get(undefined)?.map((i) => i.kind)).toEqual(['User', 'Agent']);
    expect(groups.get(child)?.map((i) => i.kind)).toEqual(['Assistant', 'Tool']);
    expect(state.agents.get(child)).toMatchObject({ status: 'Completed', usage });
  });

  it('does not list the root agent as a nested block', () => {
    const state = run([{ _tag: 'AgentSpawned', sessionId, agent: { id: agentId, name: 'Claude' } }, delta('hi')]);
    expect(state.agents.size).toBe(0);
    expect(groupByOwner(state).get(undefined)?.map((i) => i.kind)).toEqual(['User', 'Assistant']);
  });

  it('tracks running and the failure detail across a turn', () => {
    const turnId = TurnId.make('turn');
    const usage = { inputTokens: 0, outputTokens: 0 };
    const started = run([{ _tag: 'TurnStarted', sessionId, turnId }]);
    expect(started.running).toBe(true);
    const failed = reduceChat(started, { _tag: 'TurnFinished', sessionId, turnId, outcome: 'Failed', detail: 'boom', usage });
    expect(failed).toMatchObject({ running: false, failure: 'boom' });
  });
});
