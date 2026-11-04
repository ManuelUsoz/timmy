import type { PillTone } from '../../shared/ui/pill/pill';
import type { TerminalEntry } from '../workspace/terminal-entries';

export interface PillView {
  readonly tone: PillTone;
  /** What the Pill shows as its state word; the caller translates it. */
  readonly state: 'Idle' | 'Live' | 'Attention';
  /** Running Terminals, in every Project. */
  readonly running: number;
  /** Running Terminals that asked for the user (a bell or a notification) and have not been focused since. */
  readonly attention: number;
  readonly pulse: boolean;
}

/**
 * What the Pill shows: how many Terminals are running (their process is alive), or Idle when there are none.
 * A running Terminal that needs attention takes over the Pill until the user focuses it.
 */
export const pillView = (terminals: ReadonlyArray<TerminalEntry>): PillView => {
  const running = terminals.filter((terminal) => terminal.state === 'Live').length;
  const attention = terminals.filter((terminal) => terminal.state === 'Live' && terminal.activity === 'NeedsAttention').length;
  if (running === 0) return { tone: 'neutral', state: 'Idle', running, attention, pulse: false };
  return attention > 0
    ? { tone: 'waiting', state: 'Attention', running, attention, pulse: true }
    : { tone: 'running', state: 'Live', running, attention, pulse: true };
};
