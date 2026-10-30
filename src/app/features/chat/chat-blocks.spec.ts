import { describe, expect, it } from 'vitest';
import { AgentId, MessageId, SessionId, ToolCallId } from '../../../shared/chat/ids.model';
import type { ToolCall } from '../../../shared/chat/tool-call.model';
import { ProjectId, ProviderSessionId, type SessionSummary } from '../../../shared/sessions/sessions.model';
import { chatBlocks, sessionChips } from './chat-blocks';
import { groupByOwner, initialChatState, type ChatItem, type ChatState } from './chat-state';

const root = AgentId.make('root');
const sub = AgentId.make('sub');
const tool = (id: string, status: ToolCall['status'], agentId = root): ChatItem => ({
  kind: 'Tool',
  call: {
    id: ToolCallId.make(id),
    agentId,
    name: 'Read',
    kind: 'Read',
    title: `Read ${id}`,
    status,
    locations: [],
    diffs: [],
  },
});
const assistant = (text: string): ChatItem => ({
  kind: 'Assistant',
  agentId: root,
  messageId: MessageId.make(text),
  text,
  thinking: '',
});

const stateOf = (items: ChatItem[], withSub = false): ChatState => ({
  ...initialChatState,
  items,
  agents: withSub
    ? new Map([
        [
          sub,
          {
            info: { id: sub, parentId: root, name: 'Explore', task: 'look' },
            status: 'Running' as const,
            usage: undefined,
          },
        ],
      ])
    : new Map(),
});

describe('chatBlocks', () => {
  it('keeps messages in order and groups consecutive tool calls into one activity block', () => {
    const state = stateOf([{ kind: 'User', text: 'hi' }, tool('a', 'Completed'), tool('b', 'Running'), assistant('done')]);
    const blocks = chatBlocks(state, groupByOwner(state));
    expect(blocks.map((b) => b.kind)).toEqual(['User', 'Activity', 'Assistant']);
    const activity = blocks[1];
    expect(activity.kind === 'Activity' && activity.nodes.map((n) => [n.id, n.status])).toEqual([
      ['a', 'done'],
      ['b', 'running'],
    ]);
  });

  it('nests a subagent with its own tools as a group', () => {
    const state = stateOf(
      [tool('a', 'Completed'), { kind: 'Agent', agentId: sub }, tool('s1', 'Completed', sub), tool('s2', 'Pending', sub)],
      true,
    );
    const blocks = chatBlocks(state, groupByOwner(state));
    const nodes = blocks[0].kind === 'Activity' ? blocks[0].nodes : [];
    expect(nodes.map((n) => n.id)).toEqual(['a', sub]);
    expect(nodes[1].label).toBe('Explore');
    expect(nodes[1].children?.map((c) => c.id)).toEqual(['s1', 's2']);
    expect(nodes[1].badge?.label).toBe('Running');
  });

  it('flags failed tool calls', () => {
    const state = stateOf([tool('a', 'Failed')]);
    const block = chatBlocks(state, groupByOwner(state))[0];
    expect(block.kind === 'Activity' && block.nodes[0].badge).toEqual({ label: 'Failed', tone: 'error' });
  });
});

describe('sessionChips', () => {
  const summary = (id: string, title: string): SessionSummary => ({
    sessionId: SessionId.make(id),
    projectId: ProjectId.make('p'),
    provider: 'Claude',
    providerSessionId: ProviderSessionId.make(id),
    cwd: '/x',
    title,
    createdAt: 0,
    updatedAt: 0,
  });

  it('maps sessions to chips and outlines those that are not selected', () => {
    const chips = sessionChips([summary('a', 'First'), summary('b', 'Second')], SessionId.make('b'));
    expect(chips).toEqual([
      { id: 'a', label: 'First', outline: true },
      { id: 'b', label: 'Second', outline: false },
    ]);
  });

  it('falls back to a placeholder for empty titles', () => {
    expect(sessionChips([summary('a', '')], undefined)[0].label).toBe('Untitled');
  });
});
