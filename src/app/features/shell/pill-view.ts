import type { Notification } from '../../../shared/notification/notification.model';
import type { TerminalId } from '../../../shared/terminal/terminal.model';
import type { PillTone } from '../../shared/ui/pill/pill';

export interface PillView {
  readonly tone: PillTone;
  /** What the Pill shows as its state word; the caller translates it. */
  readonly state: 'Idle' | 'Live' | 'Attention';
  /** Working Terminals, in every Project. */
  readonly running: number;
  /** Working Terminals that asked for the user (a bell or a notification) and have not been focused since. */
  readonly attention: number;
  readonly pulse: boolean;
}

/**
 * What the Pill shows, from the latest Notification of every Source: how many Terminals are Working, or Idle when
 * there are none. A Working Terminal that needs attention takes over the Pill until the user focuses it. Attention is
 * not a Notification yet (it is what the output tap reads), so the caller says which Terminals have it.
 */
export const pillView = (notifications: ReadonlyArray<Notification>, needingAttention: ReadonlySet<TerminalId>): PillView => {
  const working = notifications.filter((notification) => notification.type === 'Working');
  const running = working.length;
  const attention = working.filter((notification) => needingAttention.has(notification.source.terminalId)).length;
  if (running === 0) return { tone: 'neutral', state: 'Idle', running, attention, pulse: false };
  return attention > 0
    ? { tone: 'waiting', state: 'Attention', running, attention, pulse: true }
    : { tone: 'running', state: 'Live', running, attention, pulse: true };
};
