import { describe, expect, it } from 'vitest';
import type { ProjectId } from '../../../shared/projects/projects.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import type { TerminalActivity, TerminalEntry, TerminalState } from '../workspace/terminal-entries';
import { pillView } from './pill-view';

const terminal = (id: string, state: TerminalState, activity: TerminalActivity = 'Idle'): TerminalEntry => ({
  id: TerminalId.make(id),
  projectId: 'p' as ProjectId,
  number: 1,
  state,
  activity,
});

describe('pillView', () => {
  it('is Idle, without pulse, when there are no Terminals', () => {
    expect(pillView([])).toEqual({ tone: 'neutral', state: 'Idle', running: 0, attention: 0, pulse: false });
  });

  it('counts the Terminals whose process is alive and pulses', () => {
    const view = pillView([terminal('a', 'Live'), terminal('b', 'Live')]);
    expect(view).toEqual({ tone: 'running', state: 'Live', running: 2, attention: 0, pulse: true });
  });

  it.each<TerminalState>(['Done', 'Error', 'Idle'])('does not count a %s Terminal as running', (state) => {
    expect(pillView([terminal('a', state)])).toMatchObject({ state: 'Idle', running: 0 });
    expect(pillView([terminal('a', state), terminal('b', 'Live')])).toMatchObject({ state: 'Live', running: 1 });
  });
});

describe('pillView: attention', () => {
  it('takes over the Pill when a running Terminal needs attention, and counts them', () => {
    const view = pillView([terminal('a', 'Live', 'NeedsAttention'), terminal('b', 'Live', 'Active'), terminal('c', 'Live', 'NeedsAttention')]);
    expect(view).toEqual({ tone: 'waiting', state: 'Attention', running: 3, attention: 2, pulse: true });
  });

  it('ignores the attention of a Terminal whose process ended', () => {
    expect(pillView([terminal('a', 'Done', 'NeedsAttention')])).toMatchObject({ state: 'Idle', attention: 0 });
  });

  it('goes back to Live when the user has seen them all', () => {
    expect(pillView([terminal('a', 'Live', 'Idle')])).toMatchObject({ tone: 'running', state: 'Live', attention: 0 });
  });
});
