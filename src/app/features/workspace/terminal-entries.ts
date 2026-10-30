import { Schema } from 'effect';
import type { ProjectId } from '../../../shared/sessions/sessions.model';

export const TerminalId = Schema.String.pipe(Schema.brand('TerminalId'));
export type TerminalId = typeof TerminalId.Type;

/** What a terminal row says it is doing. Only `Idle` can happen until there is a process behind them. */
export type TerminalState = 'Live' | 'Done' | 'Idle' | 'Error';

/** A terminal of a project. Local to this run of the app: nothing about terminals is stored. */
export interface TerminalEntry {
  readonly id: TerminalId;
  readonly projectId: ProjectId;
  /** Its position among the terminals the project has had, which names it ("Terminal 2"). */
  readonly number: number;
  readonly state: TerminalState;
}

/** The terminals of one project, in the order they were opened. */
export const terminalsOf = (entries: ReadonlyArray<TerminalEntry>, projectId: ProjectId): ReadonlyArray<TerminalEntry> =>
  entries.filter((entry) => entry.projectId === projectId);

/** A new, Idle terminal for the project, numbered after the last one it has. */
export const addTerminal = (entries: ReadonlyArray<TerminalEntry>, projectId: ProjectId, id: TerminalId): ReadonlyArray<TerminalEntry> => {
  const last = terminalsOf(entries, projectId).reduce((max, entry) => Math.max(max, entry.number), 0);
  return [...entries, { id, projectId, number: last + 1, state: 'Idle' }];
};

export const withState = (entries: ReadonlyArray<TerminalEntry>, id: TerminalId, state: TerminalState): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => (entry.id === id ? { ...entry, state } : entry));
