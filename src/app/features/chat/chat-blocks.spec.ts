import { describe, expect, it } from 'vitest';
import { AgentId, MessageId, SessionId, ToolCallId } from '../../../shared/chat/ids.model';
import type { ToolCall } from '../../../shared/chat/tool-call.model';
import { ProjectId, ProviderSessionId, type SessionSummary } from '../../../shared/sessions/sessions.model';
import { askTitleOf, chatBlocks, sessionChips } from './chat-blocks';
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

const partsOf = (blocks: ReturnType<typeof chatBlocks>, i = 0) => {
  const block = blocks[i];
  return block.kind === 'Agent' ? block.parts : [];
};
const nodesOf = (blocks: ReturnType<typeof chatBlocks>, i = 0) => {
  const part = partsOf(blocks, i)[0];
  return part?.kind === 'Activity' ? part.nodes : [];
};

describe('chatBlocks', () => {
  it('puts the tool calls and the reply of one turn in a single agent block, in order', () => {
    const state = stateOf([{ kind: 'User', text: 'hi' }, tool('a', 'Completed'), tool('b', 'Running'), assistant('done')]);
    const blocks = chatBlocks(state, groupByOwner(state));
    expect(blocks.map((b) => b.kind)).toEqual(['User', 'Agent']);
    expect(partsOf(blocks, 1).map((p) => p.kind)).toEqual(['Activity', 'Text']);
  });

  it('starts a new agent block after each user message', () => {
    const state = stateOf([assistant('one'), { kind: 'User', text: 'next' }, assistant('two')]);
    expect(chatBlocks(state, groupByOwner(state)).map((b) => b.kind)).toEqual(['Agent', 'User', 'Agent']);
  });

  it('folds a run of the same tool into one collapsed row with its count', () => {
    const state = stateOf([tool('a', 'Completed'), tool('b', 'Running')]);
    const [node] = nodesOf(chatBlocks(state, groupByOwner(state)));
    expect([node.label, node.meta, node.status]).toEqual(['Read', '×2', 'running']);
    expect(node.children?.map((c) => [c.id, c.label])).toEqual([
      ['a', 'a'],
      ['b', 'b'],
    ]);
  });

  it('nests a subagent with its own tools as a group', () => {
    const state = stateOf(
      [tool('a', 'Completed'), { kind: 'Agent', agentId: sub }, tool('s1', 'Completed', sub), tool('s2', 'Pending', sub)],
      true,
    );
    const nodes = nodesOf(chatBlocks(state, groupByOwner(state)));
    expect(nodes.map((n) => n.id)).toEqual(['a', sub]);
    expect(nodes[1].label).toBe('Explore');
    expect(nodes[1].children?.map((c) => c.id)).toEqual(['s1']);
    expect(nodes[1].children?.[0].meta).toBe('×2');
    expect(nodes[1].status).toBe('agent');
    expect(nodes[1].badge?.label).toBe('Live');
  });

  it('does not fold a failed call into a run, so its cross stays visible', () => {
    const state = stateOf([tool('a', 'Completed'), tool('b', 'Failed'), tool('c', 'Completed')]);
    expect(nodesOf(chatBlocks(state, groupByOwner(state))).map((n) => [n.id, n.status])).toEqual([
      ['a', 'done'],
      ['b', 'failed'],
      ['c', 'done'],
    ]);
  });

  it('flags failed tool calls', () => {
    const state = stateOf([tool('a', 'Failed')]);
    expect(nodesOf(chatBlocks(state, groupByOwner(state)))[0].status).toBe('failed');
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

  it('AC 1: carries the images of a user message into its block', () => {
    const images = [{ url: 'blob:a' }];
    const blocks = chatBlocks(stateOf([{ kind: 'User', text: 'hi', images }]), groupByOwner(stateOf([{ kind: 'User', text: 'hi', images }])));
    expect(blocks).toEqual([{ kind: 'User', text: 'hi', images }]);
  });
});

describe('askTitleOf', () => {
  const call = (name: string, title: string): ToolCall => ({
    id: ToolCallId.make('t'),
    agentId: root,
    name,
    kind: 'Write',
    title,
    status: 'Pending',
    locations: [],
    diffs: [],
  });

  it('does not say the tool name twice', () => {
    expect(askTitleOf(call('Write', 'Write C:\work\a.md'))).toBe('Write C:\work\a.md');
  });

  it('adds the name when the title does not start with it', () => {
    expect(askTitleOf(call('Shell', 'ls -la'))).toBe('Shell ls -la');
  });
});
