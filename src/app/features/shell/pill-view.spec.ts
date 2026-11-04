import { describe, expect, it } from 'vitest';
import type { Notification, TerminalStatus } from '../../../shared/notification/notification.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { pillView } from './pill-view';

const notification = (id: string, type: TerminalStatus): Notification => ({ source: { _tag: 'Terminal', terminalId: TerminalId.make(id) }, type });
const attending = (...ids: string[]): ReadonlySet<TerminalId> => new Set(ids.map((id) => TerminalId.make(id)));
const none = attending();

describe('pillView', () => {
  it('is Idle, with nothing to count, when there are no Notifications', () => {
    expect(pillView([], none)).toEqual({ status: 'Idle', count: 0 });
  });

  it('counts the Terminals in the status it shows', () => {
    expect(pillView([notification('a', 'Working'), notification('b', 'Working')], none)).toEqual({ status: 'Working', count: 2 });
    expect(pillView([notification('a', 'Done'), notification('b', 'Done'), notification('c', 'Done')], none)).toEqual({ status: 'Done', count: 3 });
  });

  it.each<[TerminalStatus]>([['Working'], ['Waiting'], ['Error'], ['Done'], ['Idle']])('shows a lone %s Terminal', (status) => {
    expect(pillView([notification('a', status)], none)).toEqual({ status, count: 1 });
  });
});

describe('pillView: the highest-priority status wins (Waiting > Error > Working > Done > Idle)', () => {
  const order: ReadonlyArray<TerminalStatus> = ['Waiting', 'Error', 'Working', 'Done', 'Idle'];

  it.each(order.flatMap((higher, index) => order.slice(index + 1).map((lower) => [higher, lower] as const)))('%s beats %s', (higher, lower) => {
    expect(pillView([notification('a', lower), notification('b', higher)], none).status).toBe(higher);
    expect(pillView([notification('a', higher), notification('b', lower)], none).status).toBe(higher);
  });

  it('counts only the Terminals in the winning status', () => {
    const view = pillView([notification('a', 'Done'), notification('b', 'Error'), notification('c', 'Working'), notification('d', 'Error')], none);
    expect(view).toEqual({ status: 'Error', count: 2 });
  });
});

describe('pillView: attention', () => {
  it('makes a Working Terminal that needs attention Waiting, and counts them', () => {
    const view = pillView(
      [notification('a', 'Working'), notification('b', 'Working'), notification('c', 'Working')],
      attending('a', 'c'),
    );
    expect(view).toEqual({ status: 'Waiting', count: 2 });
  });

  it('ignores the attention of a Terminal that is not Working', () => {
    expect(pillView([notification('a', 'Done')], attending('a'))).toEqual({ status: 'Done', count: 1 });
  });

  it('goes back to Working when the user has seen them all', () => {
    expect(pillView([notification('a', 'Working')], none)).toEqual({ status: 'Working', count: 1 });
  });
});
