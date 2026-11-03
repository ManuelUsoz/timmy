import { TerminalId } from '../../../shared/terminal/terminal.model';
import type { ProjectId } from '../../../shared/projects/projects.model';

export { TerminalId } from '../../../shared/terminal/terminal.model';
export type { TerminalEvent } from '../../../shared/terminal/terminal.model';

/** What a terminal row says it is doing. Only `Idle` can happen until there is a process behind them. */
export type TerminalState = 'Live' | 'Done' | 'Idle' | 'Error';

/** A terminal of a project. Local to this run of the app: nothing about terminals is stored. */
export interface TerminalEntry {
  readonly id: TerminalId;
  readonly projectId: ProjectId;
  /** Its position among the terminals the project has had, which names it ("Terminal 2"). */
  readonly number: number;
  readonly state: TerminalState;
  /** Output received from main, retained only for this app run so switching terminals is lossless. */
  readonly output: string;
  /** How the process ended; absent while it has not. */
  readonly exitCode?: number;
}

/** The terminals of one project, in the order they were opened. */
export const terminalsOf = (entries: ReadonlyArray<TerminalEntry>, projectId: ProjectId): ReadonlyArray<TerminalEntry> =>
  entries.filter((entry) => entry.projectId === projectId);

/** A new, Idle terminal for the project, numbered after the last one it has. */
export const addTerminal = (entries: ReadonlyArray<TerminalEntry>, projectId: ProjectId, id: TerminalId): ReadonlyArray<TerminalEntry> => {
  const last = terminalsOf(entries, projectId).reduce((max, entry) => Math.max(max, entry.number), 0);
  return [...entries, { id, projectId, number: last + 1, state: 'Idle', output: '' }];
};

export const withState = (entries: ReadonlyArray<TerminalEntry>, id: TerminalId, state: TerminalState): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => (entry.id === id ? { ...entry, state } : entry));

export const withOutput = (entries: ReadonlyArray<TerminalEntry>, id: TerminalId, data: string): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => (entry.id === id ? { ...entry, output: `${entry.output}${data}`.slice(-200_000) } : entry));

/** The process ended: a clean exit is Done, any other code is an Error that keeps the code to show. */
export const withExit = (entries: ReadonlyArray<TerminalEntry>, id: TerminalId, exitCode: number): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => (entry.id === id ? { ...entry, state: exitCode === 0 ? 'Done' : 'Error', exitCode } : entry));

/** A fresh Live process takes the place of an entry: same project and number, new id, nothing carried over. */
export const restarted = (entries: ReadonlyArray<TerminalEntry>, id: TerminalId, next: TerminalId): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => (entry.id === id ? { id: next, projectId: entry.projectId, number: entry.number, state: 'Live', output: '' } : entry));
