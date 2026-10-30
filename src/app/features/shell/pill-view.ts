import type { ChatState } from '../chat/chat-state';
import type { PillTone } from '../../shared/ui/pill/pill';

export interface PillView {
  readonly tone: PillTone;
  readonly label: string;
  readonly text: string;
  readonly meta: string;
  /** Call to action shown on the Pill (Asks: Review). */
  readonly action: string;
  readonly pulse: boolean;
  /** Running subagents; null hides the count. */
  readonly subagents: number | null;
}

export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const SUMMARY_MAX = 60;

const findLastItem = <T>(items: ReadonlyArray<T>, match: (item: T) => boolean): T | undefined => {
  for (let i = items.length - 1; i >= 0; i--) if (match(items[i]!)) return items[i];
  return undefined;
};

const NO_EXTRAS = { meta: '', action: '', pulse: false, subagents: null } as const;

const runningSubagents = (chat: ChatState): number | null => {
  let count = 0;
  for (const agent of chat.agents.values()) if (agent.status === 'Running') count++;
  return count === 0 ? null : count;
};

/**
 * Done: the last Turn completed with an answer and nothing has been asked since. The next Turn starts with a
 * User item, so it falls back to Idle (and Live once running). Undefined when the Pill is not Done.
 */
const doneSummary = (chat: ChatState): string | undefined => {
  const last = chat.items.at(-1);
  if (last?.kind !== 'Assistant' || chat.failure !== undefined) return undefined;
  const answer = findLastItem(chat.items, (item) => item.kind === 'Assistant' && item.text.trim() !== '');
  if (answer?.kind !== 'Assistant') return 'Turn complete';
  const line = answer.text.trim().split('\n')[0] ?? '';
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line;
};

/** What the Pill shows for the current Session: Idle, Live (activity, elapsed time, subagent count), Asks or Done (summary). */
export const pillView = (chat: ChatState, elapsedMs: number): PillView => {
  if (chat.permission) {
    return { ...NO_EXTRAS, tone: 'waiting', label: 'Asks', text: `${chat.permission.toolCall.name} ${chat.permission.toolCall.title}`, action: 'Review' };
  }
  if (chat.running) {
    const active = findLastItem(chat.items, (item) => item.kind === 'Tool' && item.call.status === 'Running');
    const text = active?.kind === 'Tool' ? `${active.call.name} ${active.call.title}` : 'Working…';
    return { tone: 'running', label: 'Live', text, meta: formatElapsed(elapsedMs), action: '', pulse: true, subagents: runningSubagents(chat) };
  }
  const summary = doneSummary(chat);
  if (summary !== undefined) return { ...NO_EXTRAS, tone: 'done', label: 'Done', text: summary };
  return { ...NO_EXTRAS, tone: 'neutral', label: 'Idle', text: 'Nothing running' };
};
