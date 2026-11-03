import { describe, expect, it } from 'vitest';
import type { ProjectId } from '../../../shared/projects/projects.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import type { TerminalEntry, TerminalState } from '../workspace/terminal-entries';
import { pillView } from './pill-view';

const terminal = (id: string, state: TerminalState): TerminalEntry => ({
  id: TerminalId.make(id),
  projectId: 'p' as ProjectId,
  number: 1,
  state,
  output: '',
});

describe('pillView', () => {
  it('is Idle, without pulse, when there are no Terminals', () => {
    expect(pillView([])).toEqual({ tone: 'neutral', state: 'Idle', running: 0, pulse: false });
  });

  it('counts the Terminals whose process is alive and pulses', () => {
    const view = pillView([terminal('a', 'Live'), terminal('b', 'Live')]);
    expect(view).toEqual({ tone: 'running', state: 'Live', running: 2, pulse: true });
  });

  it.each<TerminalState>(['Done', 'Error', 'Idle'])('does not count a %s Terminal as running', (state) => {
    expect(pillView([terminal('a', state)])).toMatchObject({ state: 'Idle', running: 0 });
    expect(pillView([terminal('a', state), terminal('b', 'Live')])).toMatchObject({ state: 'Live', running: 1 });
  });
});
