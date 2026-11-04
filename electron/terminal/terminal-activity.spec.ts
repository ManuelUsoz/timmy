import { describe, expect, it } from 'vitest';
import { activityOf, initialActivity, nextActivity, type ActivityEvent } from './terminal-activity';

const run = (...events: ReadonlyArray<ActivityEvent>) => events.reduce(nextActivity, initialActivity);

describe('terminal activity', () => {
  it('starts Idle', () => {
    expect(activityOf(initialActivity)).toBe('Idle');
  });

  it('is Active while output arrives and Idle after a quiet period', () => {
    expect(activityOf(run('Output'))).toBe('Active');
    expect(activityOf(run('Output', 'Output'))).toBe('Active');
    expect(activityOf(run('Output', 'Quiet'))).toBe('Idle');
  });

  it('needs attention from a bell or notification until the user focuses the Terminal', () => {
    expect(activityOf(run('Output', 'Attention'))).toBe('NeedsAttention');
    expect(activityOf(run('Output', 'Attention', 'Output', 'Quiet'))).toBe('NeedsAttention');
    expect(activityOf(run('Output', 'Attention', 'Quiet', 'Focused'))).toBe('Idle');
  });

  it('goes back to Active when focused while it is still printing', () => {
    expect(activityOf(run('Output', 'Attention', 'Focused'))).toBe('Active');
  });

  it('forgets a focus that came before the attention', () => {
    expect(activityOf(run('Focused', 'Output', 'Attention'))).toBe('NeedsAttention');
  });

  it('is Idle once the process exited, whatever it was doing', () => {
    expect(activityOf(run('Output', 'Attention', 'Exited'))).toBe('Idle');
  });
});
