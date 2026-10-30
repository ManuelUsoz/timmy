import type { StateTone } from '../../shared/ui/state/state';
import type { ChatState } from '../chat/chat-state';

/** What a session row says it is doing. */
export type SessionState = 'Live' | 'Asks' | 'Idle';

/**
 * Only the session open in the chat has a real state: it is Live while a Turn runs and Asks while it waits for
 * the user's answer. Every other session is Idle.
 */
export const sessionStateOf = (chat: ChatState, isOpen: boolean): SessionState => {
  if (!isOpen) return 'Idle';
  if (chat.permission !== undefined) return 'Asks';
  return chat.running ? 'Live' : 'Idle';
};

export const stateTone = (state: SessionState): StateTone => {
  switch (state) {
    case 'Live':
      return 'success';
    case 'Asks':
      return 'info';
    case 'Idle':
      return 'idle';
  }
};
