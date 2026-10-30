import { describe, expect, it } from 'vitest';
import { addUserMessage, initialChatState, type ChatState } from '../chat/chat-state';
import { formatElapsed, pillView } from './pill-view';
import { AgentId, MessageId, ToolCallId } from '../../../shared/chat/ids.model';
import type { ToolCall } from '../../../shared/chat/tool-call.model';

const tool = (status: ToolCall['status'], name: string, title: string): ChatState['items'][number] => ({
  kind: 'Tool',
  call: { id: ToolCallId.make('t'), agentId: AgentId.make('a'), name, title, status, kind: 'Edit' } as ToolCall,
});

describe('formatElapsed', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(192_000)).toBe('3:12');
    expect(formatElapsed(3_599_000)).toBe('59:59');
  });
});

describe('pillView', () => {
  it('is Idle when nothing runs', () => {
    expect(pillView(initialChatState, 0)).toMatchObject({ tone: 'neutral', label: 'Idle', text: 'Nothing running' });
  });

  it('is Live with the running tool and elapsed time during a Turn', () => {
    const state = { ...initialChatState, running: true, items: [tool('Completed', 'Read', 'a.ts'), tool('Running', 'Edit', 'b.ts')] };
    expect(pillView(state, 12_000)).toEqual({ tone: 'running', label: 'Live', text: 'Edit b.ts', meta: '0:12', action: '', pulse: true, subagents: null });
  });

  it('is Asks with the request and a Review action while a permission is pending', () => {
    const call = (tool('Running', 'Bash', 'git push') as { call: ToolCall }).call;
    const state = { ...initialChatState, running: true, permission: { toolCall: call } as never };
    expect(pillView(state, 0)).toMatchObject({ tone: 'waiting', label: 'Asks', text: 'Bash git push', action: 'Review' });
  });

  it('falls back to Working… when no tool is running', () => {
    expect(pillView({ ...initialChatState, running: true }, 0).text).toBe('Working…');
  });

  const assistant = (text: string): ChatState['items'][number] => ({
    kind: 'Assistant',
    agentId: AgentId.make('root'),
    messageId: MessageId.make('m'),
    text,
    thinking: '',
  });
  const agent = (id: string, status: 'Running' | 'Completed') =>
    [AgentId.make(id), { info: { id: AgentId.make(id), parentId: AgentId.make('root'), name: id }, status, usage: undefined }] as const;

  it('shows the running subagent count during a Turn, not finished ones', () => {
    const state = { ...initialChatState, running: true, agents: new Map([agent('a', 'Running'), agent('b', 'Running'), agent('c', 'Completed')]) };
    expect(pillView(state, 0).subagents).toBe(2);
  });

  it('hides the subagent count when none run', () => {
    const state = { ...initialChatState, running: true, agents: new Map([agent('c', 'Completed')]) };
    expect(pillView(state, 0).subagents).toBeNull();
  });

  it('is Done with the first line of the last answer after a Turn completes', () => {
    const state = { ...initialChatState, items: [{ kind: 'User', text: 'hi' } as const, assistant('Fixed the bug.\nMore detail.')] };
    expect(pillView(state, 0)).toMatchObject({ tone: 'done', label: 'Done', text: 'Fixed the bug.', pulse: false, subagents: null });
  });

  it('truncates a long Done summary', () => {
    const state = { ...initialChatState, items: [assistant('x'.repeat(100))] };
    const { text } = pillView(state, 0);
    expect(text).toHaveLength(60);
    expect(text.endsWith('…')).toBe(true);
  });

  it('returns to Idle when the next Turn is sent, and to Live once it runs', () => {
    const done = { ...initialChatState, items: [assistant('Done it.')] };
    const sent = addUserMessage(done, 'next');
    expect(pillView(sent, 0).label).toBe('Idle');
    expect(pillView({ ...sent, running: true }, 0).label).toBe('Live');
  });

  it('is Idle for a stored transcript, not Done', () => {
    expect(pillView({ ...initialChatState, items: [assistant('Old answer.')], stored: true }, 0).label).toBe('Idle');
  });

  it('is Idle when the Turn ended on a tool', () => {
    expect(pillView({ ...initialChatState, items: [assistant('Looking.'), tool('Completed', 'Read', 'a.ts')] }, 0).label).toBe('Idle');
  });

  it('is not Done after a failed Turn', () => {
    const state = { ...initialChatState, items: [assistant('partial')], failure: 'Failed' };
    expect(pillView(state, 0).label).toBe('Idle');
  });
});
