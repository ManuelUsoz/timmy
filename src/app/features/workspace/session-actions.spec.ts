import { en, es } from '../../core/i18n-dictionaries';
import { failureKey, failureTone, type SessionActionFailure } from './session-actions';

const failure = (action: SessionActionFailure['action'], reason: SessionActionFailure['reason']): SessionActionFailure => ({
  action,
  reason,
  detail: 'x',
});

describe('failureKey', () => {
  it('says why a session cannot be deleted while it is open', () => {
    expect(es[failureKey(failure('Delete', 'SessionActive'))]).toContain('abierta');
    expect(en[failureKey(failure('Delete', 'SessionActive'))]).toContain('open');
  });

  it('names the reasons main answers with', () => {
    expect(failureKey(failure('Rename', 'InvalidTitle'))).toBe('sessionsError.InvalidTitle');
    expect(failureKey(failure('Delete', 'SessionNotFound'))).toBe('sessionsError.SessionNotFound');
  });

  it('tells a busy chat apart from a session that could not start', () => {
    expect(failureKey(failure('New', 'Busy'))).toBe('sessions.error.busy');
    expect(failureKey(failure('New', 'Failed'))).toBe('sessions.error.newFailed');
  });

  it('falls back to a message per action when the call itself broke', () => {
    expect(failureKey(failure('Rename', 'Failed'))).toBe('sessions.error.renameFailed');
    expect(failureKey(failure('Delete', 'Failed'))).toBe('sessions.error.deleteFailed');
  });
});

describe('failureTone', () => {
  it('warns about what the user can resolve and reports what broke as an error', () => {
    expect(failureTone(failure('Delete', 'SessionActive'))).toBe('warning');
    expect(failureTone(failure('New', 'Busy'))).toBe('warning');
    expect(failureTone(failure('Rename', 'InvalidTitle'))).toBe('warning');
    expect(failureTone(failure('New', 'Failed'))).toBe('error');
    expect(failureTone(failure('Delete', 'SessionNotFound'))).toBe('error');
  });
});
