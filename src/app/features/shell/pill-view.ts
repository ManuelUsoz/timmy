import type { Notification, TerminalStatus } from '../../../shared/notification/notification.model';
import type { TerminalId } from '../../../shared/terminal/terminal.model';

export interface PillView {
  /** The highest-priority Terminal status across all Projects: what the Mascot shows. */
  readonly status: TerminalStatus;
  /** How many Terminals are in that status. Meaningless while Idle, where the Pill says nothing is running. */
  readonly count: number;
}

/** Most urgent first (GLOSSARY: Mascot). */
const PRIORITY: ReadonlyArray<TerminalStatus> = ['Waiting', 'Error', 'Working', 'Done', 'Idle'];

/**
 * What the Pill shows, from the latest Notification of every Source: the highest-priority status and how many Terminals
 * are in it. A Working Terminal that needs attention counts as Waiting until the user focuses it. Attention is not a
 * Notification yet (it is what the output tap reads), so the caller says which Terminals have it.
 */
export const pillView = (notifications: ReadonlyArray<Notification>, needingAttention: ReadonlySet<TerminalId>): PillView => {
  const statuses = notifications.map((notification): TerminalStatus =>
    notification.type === 'Working' && needingAttention.has(notification.source.terminalId) ? 'Waiting' : notification.type,
  );
  const status = PRIORITY.find((candidate) => statuses.includes(candidate)) ?? 'Idle';
  return { status, count: statuses.filter((candidate) => candidate === status).length };
};
