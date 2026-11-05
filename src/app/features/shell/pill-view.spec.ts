import { describe, expect, it } from 'vitest';
import type { Notification, TerminalStatus } from '../../../shared/notification/notification.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { pillView } from './pill-view';

const notification = (id: string, type: TerminalStatus): Notification => ({ source: { _tag: 'Terminal', terminalId: TerminalId.make(id) }, type });

describe('pillView', () => {
  it('is Idle, with nothing to count, when there are no Notifications', () => {
    expect(pillView([])).toEqual({ status: 'Idle', count: 0 });
  });

  it('counts the Terminals in the status it shows', () => {
    expect(pillView([notification('a', 'Working'), notification('b', 'Working')])).toEqual({ status: 'Working', count: 2 });
    expect(pillView([notification('a', 'Done'), notification('b', 'Done'), notification('c', 'Done')])).toEqual({ status: 'Done', count: 3 });
  });

  it.each<[TerminalStatus]>([['Working'], ['Waiting'], ['Error'], ['Done'], ['Idle']])('shows a lone %s Terminal', (status) => {
    expect(pillView([notification('a', status)])).toEqual({ status, count: 1 });
  });
});

describe('pillView: the highest-priority status wins (Waiting > Error > Working > Done > Idle)', () => {
  const order: ReadonlyArray<TerminalStatus> = ['Waiting', 'Error', 'Working', 'Done', 'Idle'];

  it.each(order.flatMap((higher, index) => order.slice(index + 1).map((lower) => [higher, lower] as const)))('%s beats %s', (higher, lower) => {
    expect(pillView([notification('a', lower), notification('b', higher)]).status).toBe(higher);
    expect(pillView([notification('a', higher), notification('b', lower)]).status).toBe(higher);
  });

  it('counts only the Terminals in the winning status', () => {
    const view = pillView([notification('a', 'Done'), notification('b', 'Error'), notification('c', 'Working'), notification('d', 'Error')]);
    expect(view).toEqual({ status: 'Error', count: 2 });
  });

  it('counts every Waiting Terminal, and goes back to Working once they are no longer Waiting', () => {
    const waiting = [notification('a', 'Waiting'), notification('b', 'Working'), notification('c', 'Waiting')];
    expect(pillView(waiting)).toEqual({ status: 'Waiting', count: 2 });
    expect(pillView([notification('a', 'Working'), notification('b', 'Working'), notification('c', 'Working')])).toEqual({ status: 'Working', count: 3 });
  });
});
