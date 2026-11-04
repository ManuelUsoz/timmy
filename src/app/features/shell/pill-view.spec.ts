import { describe, expect, it } from 'vitest';
import type { Notification, TerminalStatus } from '../../../shared/notification/notification.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { pillView } from './pill-view';

const notification = (id: string, type: TerminalStatus): Notification => ({ source: { _tag: 'Terminal', terminalId: TerminalId.make(id) }, type });
const attending = (...ids: string[]): ReadonlySet<TerminalId> => new Set(ids.map((id) => TerminalId.make(id)));
const none = attending();

describe('pillView', () => {
  it('is Idle, without pulse, when there are no Notifications', () => {
    expect(pillView([], none)).toEqual({ tone: 'neutral', state: 'Idle', running: 0, attention: 0, pulse: false });
  });

  it('counts the Working Terminals and pulses', () => {
    const view = pillView([notification('a', 'Working'), notification('b', 'Working')], none);
    expect(view).toEqual({ tone: 'running', state: 'Live', running: 2, attention: 0, pulse: true });
  });

  it.each<TerminalStatus>(['Done', 'Error', 'Idle'])('does not count a %s Terminal as running', (type) => {
    expect(pillView([notification('a', type)], none)).toMatchObject({ state: 'Idle', running: 0 });
    expect(pillView([notification('a', type), notification('b', 'Working')], none)).toMatchObject({ state: 'Live', running: 1 });
  });
});

describe('pillView: attention', () => {
  it('takes over the Pill when a Working Terminal needs attention, and counts them', () => {
    const view = pillView(
      [notification('a', 'Working'), notification('b', 'Working'), notification('c', 'Working')],
      attending('a', 'c'),
    );
    expect(view).toEqual({ tone: 'waiting', state: 'Attention', running: 3, attention: 2, pulse: true });
  });

  it('ignores the attention of a Terminal that is not Working', () => {
    expect(pillView([notification('a', 'Done')], attending('a'))).toMatchObject({ state: 'Idle', attention: 0 });
  });

  it('goes back to Live when the user has seen them all', () => {
    expect(pillView([notification('a', 'Working')], none)).toMatchObject({ tone: 'running', state: 'Live', attention: 0 });
  });
});
