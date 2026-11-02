import type { AgentId, SessionId } from '../../../shared/chat/ids.model';
import type { ToolCall } from '../../../shared/chat/tool-call.model';
import type { SessionSummary } from '../../../shared/sessions/sessions.model';
import type { ChipStripItem } from '../../shared/ui/chip-strip/chip-strip';
import type { TreeNode } from '../../shared/ui/tree-view/tree-view.types';
import type { ChatItem, ChatState, TranscriptImage } from './chat-state';

/** What the agent said or did, in order, inside one reply. */
export type AgentPart =
  | { readonly kind: 'Text'; readonly text: string; readonly thinking: string }
  /** Consecutive tool calls and subagents, shown as one compact tree. */
  | { readonly kind: 'Activity'; readonly nodes: ReadonlyArray<TreeNode> };

export type ChatBlock =
  | { readonly kind: 'User'; readonly text: string; readonly images?: ReadonlyArray<TranscriptImage> }
  /** Everything the agent did between two user messages: one box, with its tools inside. */
  | { readonly kind: 'Agent'; readonly parts: ReadonlyArray<AgentPart> };

type Groups = ReadonlyMap<AgentId | undefined, ReadonlyArray<ChatItem>>;

/** The target of a call as a short tail: the name is not repeated, and a path becomes its last segment. */
const targetOf = (call: ToolCall): string => {
  const rest = call.title.startsWith(call.name) ? call.title.slice(call.name.length).trim() : call.title.trim();
  return /^(?:[A-Za-z]:)?[\\/]\S*$/.test(rest) ? (rest.split(/[\\/]/).filter(Boolean).at(-1) ?? rest) : rest;
};

/** What an Ask says it is about: the title already starts with the tool name, so the name is not said twice. */
export const askTitleOf = (call: ToolCall): string =>
  call.title.startsWith(call.name) ? call.title : `${call.name} ${call.title}`;

const toolNode = (call: ToolCall): TreeNode => ({
  id: call.id,
  label: call.name,
  status: call.status === 'Failed' ? 'failed' : call.status === 'Completed' ? 'done' : 'running',
  meta: targetOf(call),
});

/** Runs of the same tool (Read, Read, Read) fold into one collapsed row, "Read ×3". */
const foldRuns = (nodes: ReadonlyArray<TreeNode>): ReadonlyArray<TreeNode> => {
  const out: TreeNode[] = [];
  let run: TreeNode[] = [];
  const flush = () => {
    if (run.length > 1) {
      out.push({
        id: run[0].id,
        label: run[0].label,
        meta: `×${run.length}`,
        status: run.some((n) => n.status === 'running') ? 'running' : 'done',
        children: run.map((n) => ({ ...n, label: n.meta || n.label, meta: '' })),
      });
    } else out.push(...run);
    run = [];
  };
  for (const node of nodes) {
    const foldable = node.children === undefined && node.status !== 'failed';
    if (foldable && run.length > 0 && run[0].label === node.label) run.push(node);
    else {
      flush();
      if (foldable) run = [node];
      else out.push(node);
    }
  }
  flush();
  return out;
};

const agentNode = (state: ChatState, groups: Groups, agentId: AgentId): TreeNode | undefined => {
  const agent = state.agents.get(agentId);
  if (agent === undefined) return undefined;
  const children = activityNodes(state, groups, groups.get(agentId) ?? []);
  return {
    id: agentId,
    label: agent.info.name,
    status: 'agent',
    expanded: agent.status === 'Running',
    badge:
      agent.status === 'Running'
        ? { label: 'Live', tone: 'success' }
        : agent.status === 'Completed'
          ? { label: 'Done', tone: 'idle' }
          : { label: 'Failed', tone: 'error' },
    ...(agent.detail !== undefined ? { meta: agent.detail } : agent.info.task !== undefined ? { meta: agent.info.task } : {}),
    ...(children.length > 0 ? { children } : {}),
  };
};

const activityNodes = (state: ChatState, groups: Groups, items: ReadonlyArray<ChatItem>): ReadonlyArray<TreeNode> =>
  foldRuns(
    items.flatMap((item): TreeNode[] => {
      if (item.kind === 'Tool') return [toolNode(item.call)];
      if (item.kind === 'Agent') {
        const node = agentNode(state, groups, item.agentId);
        return node === undefined ? [] : [node];
      }
      return [];
    }),
  );

/** The root agent's items as renderable blocks: user messages, and one agent box per reply with its tools inside. */
export const chatBlocks = (state: ChatState, groups: Groups): ReadonlyArray<ChatBlock> => {
  const blocks: ChatBlock[] = [];
  let parts: AgentPart[] = [];
  let run: ChatItem[] = [];
  const flushRun = () => {
    const nodes = activityNodes(state, groups, run);
    run = [];
    if (nodes.length > 0) parts.push({ kind: 'Activity', nodes });
  };
  const flushAgent = () => {
    flushRun();
    if (parts.length > 0) blocks.push({ kind: 'Agent', parts });
    parts = [];
  };
  for (const item of groups.get(undefined) ?? []) {
    if (item.kind === 'Tool' || item.kind === 'Agent') {
      run.push(item);
    } else if (item.kind === 'User') {
      flushAgent();
      blocks.push({ kind: 'User', text: item.text, ...(item.images !== undefined ? { images: item.images } : {}) });
    } else {
      flushRun();
      parts.push({ kind: 'Text', text: item.text, thinking: item.thinking });
    }
  }
  flushAgent();
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
