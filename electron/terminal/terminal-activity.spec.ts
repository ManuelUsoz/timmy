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

describe('terminal activity reported by a Hook', () => {
  it('follows Working, Waiting and Done', () => {
    expect(activityOf(run('HookWorking'))).toBe('Active');
    expect(activityOf(run('HookWorking', 'HookWaiting'))).toBe('NeedsAttention');
    expect(activityOf(run('HookWaiting', 'HookWorking'))).toBe('Active');
    expect(activityOf(run('HookWorking', 'HookDone'))).toBe('Idle');
  });

  it('replaces what the output says: printing is not Working, quiet is not Done, a bell is not Waiting', () => {
    expect(activityOf(run('HookDone', 'Output'))).toBe('Idle');
    expect(activityOf(run('HookWorking', 'Output', 'Quiet'))).toBe('Active');
    expect(activityOf(run('HookDone', 'Output', 'Attention'))).toBe('Idle');
  });

  it('keeps Waiting when the user focuses the Terminal: it only ends when the agent goes on', () => {
    expect(activityOf(run('HookWaiting', 'Focused'))).toBe('NeedsAttention');
  });

  it('falls back to the output when the Provider session ends', () => {
    expect(activityOf(run('HookWorking', 'HookEnded'))).toBe('Idle');
    expect(activityOf(run('HookWorking', 'HookEnded', 'Output'))).toBe('Active');
  });

  it('is Idle once the process exited, and the output is generic again in a restarted Terminal', () => {
    expect(activityOf(run('HookWaiting', 'Exited'))).toBe('Idle');
    expect(activityOf(run('HookWorking', 'Exited', 'Output'))).toBe('Active');
  });
});
