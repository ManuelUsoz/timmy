import { AgentId, MessageId, ToolCallId } from '../../../shared/chat/ids.model';
import type { HistoryItem } from '../../../shared/sessions/sessions.model';
import { initialChatState, type ChatItem, type ChatState } from '../chat/chat-state';

/** Stored transcripts do not record ownership; every item renders at the top level. */
const owner = AgentId.make('history');

const toItem = (item: HistoryItem, index: number): ChatItem => {
  switch (item._tag) {
    case 'Message':
      return item.role === 'User'
        ? { kind: 'User', text: item.text }
        : { kind: 'Assistant', agentId: owner, messageId: MessageId.make(`history-${index}`), text: item.text, thinking: '' };
    case 'ToolCall':
      return {
        kind: 'Tool',
        call: {
          id: ToolCallId.make(`history-${index}`),
          agentId: owner,
          name: item.toolName,
          kind: 'Other',
          title: item.toolName,
          status: 'Completed',
          locations: [],
          diffs: [],
          output: item.input,
        },
      };
  }
};

/** A chat state that shows a stored conversation. */
export const chatStateFromHistory = (history: ReadonlyArray<HistoryItem>): ChatState => ({
  ...initialChatState,
  items: history.map(toItem),
  stored: true,
});
