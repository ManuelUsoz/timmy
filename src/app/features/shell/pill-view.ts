import type { Notification, TerminalStatus } from '../../../shared/notification/notification.model';

export interface PillView {
  /** The highest-priority Terminal status across all Projects: what the Mascot shows. */
  readonly status: TerminalStatus;
  /** How many Terminals are in that status. Meaningless while Idle, where the Pill says nothing is running. */
  readonly count: number;
}

/** Most urgent first (GLOSSARY: Mascot). */
export const PRIORITY: ReadonlyArray<TerminalStatus> = ['Waiting', 'Error', 'Working', 'Done', 'Idle'];

/** The status the Mascot counts a Notification as: a Done or Error the user has Seen is Idle (GLOSSARY: Seen). */
export const mascotStatus = (notification: Notification): TerminalStatus => (notification.seen ? 'Idle' : notification.type);

/**
 * What the Pill shows, from the latest Notification of every Source: the highest-priority status and how many Terminals
 * are in it. Waiting is a status of its own: main publishes it when a Hook reports it or a bell reaches the output tap.
 */
/** The highest-priority status among `statuses`; undefined when there are none. */
export const mostUrgent = (statuses: ReadonlyArray<TerminalStatus>): TerminalStatus | undefined =>
  PRIORITY.find((candidate) => statuses.includes(candidate));

export const pillView = (notifications: ReadonlyArray<Notification>): PillView => {
  const statuses = notifications.map(mascotStatus);
  const status = mostUrgent(statuses) ?? 'Idle';
  return { status, count: statuses.filter((candidate) => candidate === status).length };
};

/** The word for each Terminal status, as a translation key: what the Pill and the Panel say next to the Mascot. */
export const statusWordKey = {
  Working: 'state.live',
  Idle: 'state.idle',
  Waiting: 'activity.needsAttention',
  Done: 'state.done',
  Error: 'state.error',
} as const satisfies Record<TerminalStatus, string>;
