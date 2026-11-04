import type { TerminalActivity } from '../../src/shared/terminal/terminal.model';

/** What the output tap, the idle timer and the user can say about a Terminal. They only count while no Hook is reporting. */
type GenericEvent = 'Output' | 'Attention' | 'Quiet' | 'Focused';

/**
 * What can happen to a Terminal's activity. `Output` and `Attention` come from the output tap, the generic producer;
 * `Hook*` come from a Provider's Hook, which knows better and replaces the tap's reading until its session ends;
 * `Quiet` is the idle timer; `Focused` is the user; `Exited` is the process.
 */
export type ActivityEvent = GenericEvent | 'Exited' | 'HookWorking' | 'HookWaiting' | 'HookDone' | 'HookEnded';

export interface ActivityState {
  readonly busy: boolean;
  readonly attention: boolean;
  /** What the Provider's Hook last reported. While it is set the generic events are ignored. */
  readonly hook?: 'Working' | 'Waiting' | 'Done';
}

export const initialActivity: ActivityState = { busy: false, attention: false };

const nextGeneric = (state: ActivityState, event: GenericEvent): ActivityState => {
  switch (event) {
    case 'Output':
      return { ...state, busy: true };
    case 'Attention':
      return { ...state, attention: true };
    case 'Quiet':
      return { ...state, busy: false };
    case 'Focused':
      return { ...state, attention: false };
  }
};

export const nextActivity = (state: ActivityState, event: ActivityEvent): ActivityState => {
  switch (event) {
    case 'HookWorking':
      return { ...state, hook: 'Working' };
    case 'HookWaiting':
      return { ...state, hook: 'Waiting' };
    case 'HookDone':
      return { ...state, hook: 'Done' };
    case 'HookEnded': {
      const { hook: _ended, ...rest } = state;
      return rest;
    }
    case 'Exited':
      return initialActivity;
    default:
      return state.hook === undefined ? nextGeneric(state, event) : state;
  }
};

const hookActivity: Readonly<Record<NonNullable<ActivityState['hook']>, TerminalActivity>> = {
  Working: 'Active',
  Waiting: 'NeedsAttention',
  Done: 'Idle',
};

export const activityOf = (state: ActivityState): TerminalActivity => {
  if (state.hook !== undefined) return hookActivity[state.hook];
  return state.attention ? 'NeedsAttention' : state.busy ? 'Active' : 'Idle';
};
