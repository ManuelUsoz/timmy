import type { SessionsError } from '../../../shared/sessions/sessions-error.model';
import type { MessageKey } from '../../core/i18n-dictionaries';

/**
 * What went wrong with an action on Sessions, for the user to read. The reasons are the ones main answers with,
 * plus `Busy` (a Turn is running, so the open session cannot be switched away from) and `Failed` (the call itself
 * broke, which no reason describes).
 */
export interface SessionActionFailure {
  readonly action: 'New' | 'Rename' | 'Delete';
  readonly reason: SessionsError['reason'] | 'Busy' | 'Failed';
  /** What main or the chat said, kept for the toast tooltip. */
  readonly detail: string;
}

/** The text key that tells the user about a failure. */
export const failureKey = (failure: SessionActionFailure): MessageKey => {
  switch (failure.reason) {
    case 'Busy':
      return 'sessions.error.busy';
    case 'SessionNotFound':
      return 'sessionsError.SessionNotFound';
    case 'SessionActive':
      return 'sessionsError.SessionActive';
    case 'InvalidTitle':
      return 'sessionsError.InvalidTitle';
    case 'Failed':
      switch (failure.action) {
        case 'New':
          return 'sessions.error.newFailed';
        case 'Rename':
          return 'sessions.error.renameFailed';
        case 'Delete':
          return 'sessions.error.deleteFailed';
      }
  }
};

/** Refusals the user can resolve themselves are warnings; a call that broke is an error. */
export const failureTone = (failure: SessionActionFailure): 'warning' | 'error' => {
  switch (failure.reason) {
    case 'Busy':
    case 'SessionActive':
    case 'InvalidTitle':
      return 'warning';
    case 'SessionNotFound':
    case 'Failed':
      return 'error';
  }
};
