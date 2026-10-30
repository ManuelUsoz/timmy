import type { MessageKey } from '../../core/i18n-dictionaries';
import type { StateTone } from '../../shared/ui/state/state';
import type { TerminalState } from './terminal-entries';

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

/** "C:\Users\ana\timmy" becomes "…\timmy": the last folder, with the separator the path uses. */
export const shortPath = (cwd: string): string => {
  const trimmed = cwd.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
  return cut < 0 ? trimmed : `…${trimmed[cut]}${trimmed.slice(cut + 1)}`;
};
