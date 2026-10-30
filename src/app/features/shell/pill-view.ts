import type { ChatState } from '../chat/chat-state';
import type { PillTone } from '../../shared/ui/pill/pill';

export interface PillView {
  readonly tone: PillTone;
  readonly label: string;
  readonly text: string;
  readonly meta: string;
  readonly pulse: boolean;
  /** Running subagents; null hides the count. */
  readonly subagents: number | null;
}

export const formatElapsed = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
};

const SUMMARY_MAX = 60;

const runningSubagents = (chat: ChatState): number | null => {
  const count = [...chat.agents.values()].filter((agent) => agent.status === 'Running').length;
  return count === 0 ? null : count;
};

/**
 * Done: the last Turn completed with an answer and nothing has been asked since. The next Turn starts with a
 * User item, so it falls back to Idle (and Live once running). Undefined when the Pill is not Done.
 */
const doneSummary = (chat: ChatState): string | undefined => {
  const last = chat.items.at(-1);
  if (last === undefined || last.kind === 'User' || chat.failure !== undefined) return undefined;
  const answer = [...chat.items].reverse().find((item) => item.kind === 'Assistant' && item.text.trim() !== '');
  if (answer?.kind !== 'Assistant') return 'Turn complete';
  const line = answer.text.trim().split('\n')[0] ?? '';
  return line.length > SUMMARY_MAX ? `${line.slice(0, SUMMARY_MAX - 1)}…` : line;
};

/** What the Pill shows for the current Session: Idle, Live (activity, elapsed time, subagent count), Asks or Done (summary). */
export const pillView = (chat: ChatState, elapsedMs: number): PillView => {
  if (chat.permission) {
    return { tone: 'waiting', label: 'Asks', text: `${chat.permission.toolCall.name} ${chat.permission.toolCall.title}`, meta: '', pulse: false, subagents: null };
  }
  if (chat.running) {
    const active = [...chat.items].reverse().find((item) => item.kind === 'Tool' && item.call.status === 'Running');
    const text = active?.kind === 'Tool' ? `${active.call.name} ${active.call.title}` : 'Working…';
    return { tone: 'running', label: 'Live', text, meta: formatElapsed(elapsedMs), pulse: true, subagents: runningSubagents(chat) };
  }
  const summary = doneSummary(chat);
  if (summary !== undefined) return { tone: 'done', label: 'Done', text: summary, meta: '', pulse: false, subagents: null };
  return { tone: 'neutral', label: 'Idle', text: 'Nothing running', meta: '', pulse: false, subagents: null };
};
