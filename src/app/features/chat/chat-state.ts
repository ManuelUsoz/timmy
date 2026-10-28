import type { AgentInfo, AgentOutcome } from '../../../shared/chat/agent.model';
import type { ChatEvent } from '../../../shared/chat/event.model';
import type { AgentId, MessageId } from '../../../shared/chat/ids.model';
import type { PermissionRequest } from '../../../shared/chat/permission.model';
import type { ToolCall } from '../../../shared/chat/tool-call.model';
import type { ContextWindow, Usage } from '../../../shared/chat/usage.model';

export type ChatItem =
  | { readonly kind: 'User'; readonly text: string }
  | {
      readonly kind: 'Assistant';
      readonly agentId: AgentId;
      readonly messageId: MessageId;
      readonly text: string;
      readonly thinking: string;
    }
  | { readonly kind: 'Tool'; readonly call: ToolCall }
  /** Where a subagent was spawned; its own items hang under it (see `groupByOwner`). */
  | { readonly kind: 'Agent'; readonly agentId: AgentId };

export interface AgentView {
  readonly info: AgentInfo;
  readonly status: 'Running' | AgentOutcome;
  readonly usage: Usage | undefined;
}

export interface ChatState {
  readonly items: ReadonlyArray<ChatItem>;
  /** Subagents by id. The root agent is not listed. */
  readonly agents: ReadonlyMap<AgentId, AgentView>;
  readonly permission: PermissionRequest | undefined;
  /** Cumulative for the whole session. */
  readonly usage: Usage | undefined;
  readonly context: ContextWindow | undefined;
  readonly running: boolean;
  /** Set when the last turn did not complete. */
  readonly failure: string | undefined;
}

export const initialChatState: ChatState = {
  items: [],
  agents: new Map(),
  permission: undefined,
  usage: undefined,
  context: undefined,
  running: false,
  failure: undefined,
};

export const addUserMessage = (state: ChatState, text: string): ChatState => ({
  ...state,
  items: [...state.items, { kind: 'User', text }],
  failure: undefined,
});

const updateAgent = (state: ChatState, agentId: AgentId, update: (agent: AgentView) => AgentView): ChatState => {
  const agent = state.agents.get(agentId);
  return agent === undefined ? state : { ...state, agents: new Map(state.agents).set(agentId, update(agent)) };
};

const ownerOf = (state: ChatState, item: ChatItem): AgentId | undefined => {
  const owner =
    item.kind === 'Assistant' ? item.agentId : item.kind === 'Tool' ? item.call.agentId : item.kind === 'Agent' ? state.agents.get(item.agentId)?.info.parentId : undefined;
  // The root agent is never in `agents`, so anything it owns is top level.
  return owner !== undefined && state.agents.has(owner) ? owner : undefined;
};

/** Items per owning subagent, in order; the key `undefined` holds the root agent's top level. */
export const groupByOwner = (state: ChatState): ReadonlyMap<AgentId | undefined, ReadonlyArray<ChatItem>> => {
  const groups = new Map<AgentId | undefined, ChatItem[]>();
  for (const item of state.items) {
    const owner = ownerOf(state, item);
    groups.set(owner, [...(groups.get(owner) ?? []), item]);
  }
  return groups;
};

/** Text and thinking arrive as deltas of one message id; tool updates replace the call with the same id. */
export const reduceChat = (state: ChatState, event: ChatEvent): ChatState => {
  switch (event._tag) {
    case 'TurnStarted':
      return { ...state, running: true, failure: undefined };
    case 'MessageDelta': {
      const index = state.items.findIndex((i) => i.kind === 'Assistant' && i.messageId === event.messageId);
      const field = event.channel === 'Text' ? 'text' : 'thinking';
      const existing = state.items[index];
      if (existing?.kind === 'Assistant') {
        const items = state.items.map((item, i) =>
          i === index && item.kind === 'Assistant' ? { ...item, [field]: item[field] + event.text } : item,
        );
        return { ...state, items };
      }
      const fresh: ChatItem = {
        kind: 'Assistant',
        agentId: event.agentId,
        messageId: event.messageId,
        text: field === 'text' ? event.text : '',
        thinking: field === 'thinking' ? event.text : '',
      };
      return { ...state, items: [...state.items, fresh] };
    }
    case 'ToolCallStarted':
    case 'ToolCallUpdated': {
      const known = state.items.some((i) => i.kind === 'Tool' && i.call.id === event.call.id);
      const items = known
        ? state.items.map((item) => (item.kind === 'Tool' && item.call.id === event.call.id ? { ...item, call: event.call } : item))
        : [...state.items, { kind: 'Tool', call: event.call } as const];
      return { ...state, items };
    }
    case 'PermissionRequested':
      return { ...state, permission: event.request };
    case 'PermissionResolved':
      return state.permission?.id === event.requestId ? { ...state, permission: undefined } : state;
    case 'AgentSpawned':
      // The root agent has no parent; it is the top level, not a nested block.
      if (event.agent.parentId === undefined) return state;
      return {
        ...state,
        agents: new Map(state.agents).set(event.agent.id, { info: event.agent, status: 'Running', usage: undefined }),
        items: [...state.items, { kind: 'Agent', agentId: event.agent.id }],
      };
    case 'AgentFinished':
      return updateAgent(state, event.agentId, (agent) => ({
        ...agent,
        status: event.outcome,
        usage: event.usage ?? agent.usage,
      }));
    case 'UsageUpdated':
      return event.agentId === undefined
        ? { ...state, usage: event.usage, context: event.context ?? state.context }
        : updateAgent(state, event.agentId, (agent) => ({ ...agent, usage: event.usage }));
    case 'TurnFinished':
      return {
        ...state,
        running: false,
        permission: undefined,
        failure: event.outcome === 'Completed' ? undefined : (event.detail ?? event.outcome),
      };
    case 'SessionStarted':
    case 'QuestionAsked':
    case 'QuestionResolved':
      return state;
  }
};
