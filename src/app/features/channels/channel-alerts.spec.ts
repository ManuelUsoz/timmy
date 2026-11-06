import type { Notification, NotificationEvent, TerminalStatus } from '../../../shared/notification/notification.model';
import type { ChannelSettings } from '../../../shared/settings/settings.model';
import { TerminalId } from '../../../shared/terminal/terminal.model';
import { alerts, hear, type Heard } from './channel-alerts';

const source = (id: string) => ({ _tag: 'Terminal', terminalId: TerminalId.make(id) }) as const;
const notification = (id: string, type: TerminalStatus, extra: Partial<Pick<Notification, 'seen' | 'onScreen'>> = {}): Notification => ({
  source: source(id),
  type,
  seen: false,
  onScreen: false,
  ...extra,
});
const notified = (n: Notification): NotificationEvent => ({ _tag: 'Notified', notification: n });

const allOn: ChannelSettings = { enabled: true, types: ['Waiting', 'Done', 'Error'] };

describe('alerts: which Notifications a Channel alerts about', () => {
  it('alerts for Waiting, Done and Error while the Channel and the type are on', () => {
    expect(alerts(allOn, notification('a', 'Waiting'))).toBe(true);
    expect(alerts(allOn, notification('a', 'Done'))).toBe(true);
    expect(alerts(allOn, notification('a', 'Error'))).toBe(true);
  });

  it('never alerts for Working or Idle', () => {
    expect(alerts(allOn, notification('a', 'Working'))).toBe(false);
    expect(alerts(allOn, notification('a', 'Idle'))).toBe(false);
  });

  it('does not alert for a type the user switched off, and still alerts for the others', () => {
    const noDone: ChannelSettings = { enabled: true, types: ['Waiting', 'Error'] };
    expect(alerts(noDone, notification('a', 'Done'))).toBe(false);
    expect(alerts(noDone, notification('a', 'Waiting'))).toBe(true);
  });

  it('does not alert at all while the Channel is off, whatever its types', () => {
    const off: ChannelSettings = { ...allOn, enabled: false };
    expect(alerts(off, notification('a', 'Waiting'))).toBe(false);
    expect(alerts(off, notification('a', 'Error'))).toBe(false);
  });

  it('does not alert about a Source that is on screen, whatever its status', () => {
    expect(alerts(allOn, notification('a', 'Waiting', { onScreen: true }))).toBe(false);
    expect(alerts(allOn, notification('a', 'Error', { onScreen: true, seen: true }))).toBe(false);
  });

  it('does not alert about a Done or Error the user has already seen', () => {
    expect(alerts(allOn, notification('a', 'Done', { seen: true }))).toBe(false);
  });
});

describe('hear: which events are a Source entering a status', () => {
  const start: Heard = new Map();

  it('a Source entering a status is news, each time the status changes', () => {
    const first = hear(start, notified(notification('a', 'Working')));
    expect(first.entered).toEqual(notification('a', 'Working'));
    const second = hear(first.heard, notified(notification('a', 'Waiting')));
    expect(second.entered).toEqual(notification('a', 'Waiting'));
  });

  it('a Done becoming Seen is not news: the Source did not enter a status', () => {
    const done = hear(start, notified(notification('a', 'Done')));
    expect(hear(done.heard, notified(notification('a', 'Done', { seen: true, onScreen: true }))).entered).toBeUndefined();
  });

  it('a retracted Source is forgotten, so a Source with the same id is news again', () => {
    const done = hear(start, notified(notification('a', 'Done')));
    const gone = hear(done.heard, { _tag: 'Retracted', source: source('a') });
    expect(gone.entered).toBeUndefined();
    expect(hear(gone.heard, notified(notification('a', 'Done'))).entered).toEqual(notification('a', 'Done'));
  });
});
