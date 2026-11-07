import type { TerminalStatus } from '../../../shared/notification/notification.model';
import type { MessageKey } from '../../core/i18n-dictionaries';
import type { StateTone } from '../../shared/ui/state/state';
import type { TerminalActivity, TerminalEntry, TerminalState } from './terminal-entries';

/** The Terminal status names (GLOSSARY), as translation keys. */
export const statusKey = {
  Working: 'state.working',
  Waiting: 'state.waiting',
  Done: 'state.done',
  Error: 'state.error',
  Idle: 'state.idle',
} as const satisfies Record<TerminalStatus, MessageKey>;

export const terminalTone = (state: TerminalState): StateTone => {
  switch (state) {
    case 'Live':
      return 'success';
    case 'Error':
      return 'error';
    case 'Done':
    case 'Idle':
      return 'idle';
  }
};

export const terminalStateKey = (state: TerminalState): MessageKey => {
  switch (state) {
    case 'Live':
      return 'state.live';
    case 'Done':
      return 'state.done';
    case 'Idle':
      return 'state.idle';
    case 'Error':
      return 'state.error';
  }
};

export interface TerminalBadge {
  readonly tone: StateTone;
  readonly key: MessageKey;
  /** Present while the process is alive: the activity the badge says. */
  readonly activity?: TerminalActivity;
}

/**
 * What a Terminal's row says. A live Terminal says what it is doing (printing, quiet, asking for the user); one
 * without a process says how it ended.
 */
export const terminalBadge = (terminal: Pick<TerminalEntry, 'state' | 'activity'>): TerminalBadge => {
  if (terminal.state !== 'Live') return { tone: terminalTone(terminal.state), key: terminalStateKey(terminal.state) };
  switch (terminal.activity) {
    case 'Active':
      return { tone: 'success', key: 'activity.active', activity: 'Active' };
    case 'Idle':
      return { tone: 'idle', key: 'activity.idle', activity: 'Idle' };
    case 'NeedsAttention':
      return { tone: 'warning', key: 'activity.needsAttention', activity: 'NeedsAttention' };
  }
};

/** "C:\Users\ana\timmy" becomes "…\timmy": the last folder, with the separator the path uses. */
export const shortPath = (cwd: string): string => {
  const trimmed = cwd.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return cut < 0 ? trimmed : `…${trimmed[cut]}${trimmed.slice(cut + 1)}`;
};
