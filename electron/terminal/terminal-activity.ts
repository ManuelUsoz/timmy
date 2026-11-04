import type { TerminalActivity } from '../../src/shared/terminal/terminal.model';

/**
 * What can happen to a Terminal's activity. `Output` and `Attention` come from a producer of signals (today the
 * output tap; later a Hook); `Quiet` is the idle timer; `Focused` is the user; `Exited` is the process.
 */
export type ActivityEvent = 'Output' | 'Attention' | 'Quiet' | 'Focused' | 'Exited';

export interface ActivityState {
  readonly busy: boolean;
  readonly attention: boolean;
}

export const initialActivity: ActivityState = { busy: false, attention: false };

export const nextActivity = (state: ActivityState, event: ActivityEvent): ActivityState => {
  switch (event) {
    case 'Output':
      return { ...state, busy: true };
    case 'Attention':
      return { ...state, attention: true };
    case 'Quiet':
      return { ...state, busy: false };
    case 'Focused':
      return { ...state, attention: false };
    case 'Exited':
      return initialActivity;
  }
};

export const activityOf = (state: ActivityState): TerminalActivity =>
  state.attention ? 'NeedsAttention' : state.busy ? 'Active' : 'Idle';
