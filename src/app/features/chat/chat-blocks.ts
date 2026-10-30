import type { AgentId, SessionId } from '../../../shared/chat/ids.model';
import type { ToolCall } from '../../../shared/chat/tool-call.model';
import type { SessionSummary } from '../../../shared/sessions/sessions.model';
import type { ChipStripItem } from '../../shared/ui/chip-strip/chip-strip';
import type { TreeNode } from '../../shared/ui/tree-view/tree-view.types';
import type { ChatItem, ChatState } from './chat-state';

export type ChatBlock =
  | { readonly kind: 'User'; readonly text: string }
  | { readonly kind: 'Assistant'; readonly text: string; readonly thinking: string }
  /** Consecutive tool calls and subagents, shown as one tree under the reply. */
  | { readonly kind: 'Activity'; readonly nodes: ReadonlyArray<TreeNode> };

type Groups = ReadonlyMap<AgentId | undefined, ReadonlyArray<ChatItem>>;

const toolNode = (call: ToolCall): TreeNode => ({
  id: call.id,
  label: call.name,
  status: call.status === 'Completed' || call.status === 'Failed' ? 'done' : 'running',
  meta: call.title,
  ...(call.status === 'Failed' ? { badge: { label: 'Failed', tone: 'error' as const } } : {}),
});

const agentNode = (state: ChatState, groups: Groups, agentId: AgentId): TreeNode | undefined => {
  const agent = state.agents.get(agentId);
  if (agent === undefined) return undefined;
  const children = activityNodes(state, groups, groups.get(agentId) ?? []);
  return {
    id: agentId,
    label: agent.info.name,
    expanded: agent.status === 'Running',
    badge: {
      label: agent.status,
      tone: agent.status === 'Running' ? 'success' : agent.status === 'Completed' ? 'idle' : 'error',
    },
    ...(agent.info.task !== undefined ? { meta: agent.info.task } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
};

const activityNodes = (state: ChatState, groups: Groups, items: ReadonlyArray<ChatItem>): ReadonlyArray<TreeNode> =>
  items.flatMap((item): TreeNode[] => {
    if (item.kind === 'Tool') return [toolNode(item.call)];
    if (item.kind === 'Agent') {
      const node = agentNode(state, groups, item.agentId);
      return node === undefined ? [] : [node];
    }
    return [];
  });

/** The root agent's items as renderable blocks, tool activity folded into trees. */
export const chatBlocks = (state: ChatState, groups: Groups): ReadonlyArray<ChatBlock> => {
  const blocks: ChatBlock[] = [];
  let run: ChatItem[] = [];
  const flush = () => {
    const nodes = activityNodes(state, groups, run);
    run = [];
    if (nodes.length > 0) blocks.push({ kind: 'Activity', nodes });
  };
  for (const item of groups.get(undefined) ?? []) {
    if (item.kind === 'Tool' || item.kind === 'Agent') {
      run.push(item);
      continue;
    }
    flush();
    blocks.push(
      item.kind === 'User'
        ? { kind: 'User', text: item.text }
        : { kind: 'Assistant', text: item.text, thinking: item.thinking },
    );
  }
  flush();
  return blocks;
};

export const sessionChips = (
  sessions: ReadonlyArray<SessionSummary>,
  selected: SessionId | undefined,
): ReadonlyArray<ChipStripItem> =>
  sessions.map((s) => ({
    id: s.sessionId,
    label: s.title === '' ? 'Untitled' : s.title,
    outline: s.sessionId !== selected,
  }));
