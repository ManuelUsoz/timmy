import type { PillTone } from '../../shared/ui/pill/pill';
import type { TerminalEntry } from '../workspace/terminal-entries';

export interface PillView {
  readonly tone: PillTone;
  /** What the Pill shows as its state word; the caller translates it. */
  readonly state: 'Idle' | 'Live';
  /** Running Terminals, in every Project. */
  readonly running: number;
  readonly pulse: boolean;
}

/** What the Pill shows: how many Terminals are running (their process is alive), or Idle when there are none. */
export const pillView = (terminals: ReadonlyArray<TerminalEntry>): PillView => {
  const running = terminals.filter((terminal) => terminal.state === 'Live').length;
  return running === 0
    ? { tone: 'neutral', state: 'Idle', running, pulse: false }
    : { tone: 'running', state: 'Live', running, pulse: true };
};
