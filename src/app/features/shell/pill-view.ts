import type { ChatState } from '../chat/chat-state';
import type { PillTone } from '../../shared/ui/pill/pill';

export interface PillView {
  readonly tone: PillTone;
  readonly label: string;
  readonly text: string;
  readonly meta: string;
  readonly pulse: boolean;
}

export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

/** What the Pill shows for the current Session: Idle, Live (activity and elapsed time) or Asks. */
export const pillView = (chat: ChatState, elapsedMs: number): PillView => {
  if (chat.permission) {
    return { tone: 'waiting', label: 'Asks', text: `${chat.permission.toolCall.name} ${chat.permission.toolCall.title}`, meta: '', pulse: false };
  }
  if (chat.running) {
    const active = [...chat.items].reverse().find((item) => item.kind === 'Tool' && item.call.status === 'Running');
    const text = active?.kind === 'Tool' ? `${active.call.name} ${active.call.title}` : 'Working…';
    return { tone: 'running', label: 'Live', text, meta: formatElapsed(elapsedMs), pulse: true };
  }
  return { tone: 'neutral', label: 'Idle', text: 'Nothing running', meta: '', pulse: false };
};
