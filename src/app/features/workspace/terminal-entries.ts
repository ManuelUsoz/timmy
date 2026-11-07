import { TerminalId, type TerminalActivity, type TerminalActivityEntry } from '../../../shared/terminal/terminal.model';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import type { TabId } from './tabs';

export { TerminalId } from '../../../shared/terminal/terminal.model';
export type { TerminalActivity, TerminalEvent } from '../../../shared/terminal/terminal.model';

/** What a terminal row says it is doing. Only `Idle` can happen until there is a process behind them. */
export type TerminalState = 'Live' | 'Done' | 'Idle' | 'Error';

/** A Terminal's screen as xterm serialized it, with the size it was at: it is restored at that size and then fitted. */
export interface TerminalScreenSnapshot {
  readonly cols: number;
  readonly rows: number;
  readonly data: string;
}

/** A terminal of a project. Local to this run of the app: nothing about terminals is stored. */
export interface TerminalEntry {
  readonly id: TerminalId;
  readonly projectId: ProjectId;
  /** The Tab it is in (GLOSSARY: Tab). Closing that Tab closes it. */
  readonly tabId: TabId;
  /** Its position among the terminals the project has had, which names it ("Terminal 2"). */
  readonly number: number;
  readonly state: TerminalState;
  /** What its output says it is doing, as main reads it. Meaningful while the process is alive. */
  readonly activity: TerminalActivity;
  /** The screen it had when it was last shown, retained only for this app run so switching terminals is lossless. */
  readonly screen?: TerminalScreenSnapshot;
  /** The Provider whose CLI it was opened with, so a restart runs it again; absent for a plain shell. */
  readonly provider?: Provider;
  /** How the process ended; absent while it has not. */
  readonly exitCode?: number;
}

/** The terminals of one project, in the order they were opened. */
export const terminalsOf = (entries: ReadonlyArray<TerminalEntry>, projectId: ProjectId): ReadonlyArray<TerminalEntry> =>
  entries.filter((entry) => entry.projectId === projectId);

/** A new, Idle terminal for the project, in the given Tab, numbered after the last one the project has. */
export const addTerminal = (entries: ReadonlyArray<TerminalEntry>, projectId: ProjectId, tabId: TabId, id: TerminalId, provider?: Provider): ReadonlyArray<TerminalEntry> => {
  const last = terminalsOf(entries, projectId).reduce((max, entry) => Math.max(max, entry.number), 0);
  return [...entries, { id, projectId, tabId, number: last + 1, state: 'Idle', activity: 'Idle', ...(provider === undefined ? {} : { provider }) }];
};

export const withState = (entries: ReadonlyArray<TerminalEntry>, id: TerminalId, state: TerminalState): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => (entry.id === id ? { ...entry, state } : entry));

/** Applies the activity main reports; Terminals main does not know (not started) keep theirs. */
export const withActivity = (entries: ReadonlyArray<TerminalEntry>, snapshot: ReadonlyArray<TerminalActivityEntry>): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => {
    const reported = snapshot.find((item) => item.terminalId === entry.id);
    return reported === undefined || reported.activity === entry.activity ? entry : { ...entry, activity: reported.activity };
  });

export const withScreen = (entries: ReadonlyArray<TerminalEntry>, id: TerminalId, screen: TerminalScreenSnapshot): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => (entry.id === id ? { ...entry, screen } : entry));

/** The process ended: a clean exit is Done, any other code is an Error that keeps the code to show. */
export const withExit = (entries: ReadonlyArray<TerminalEntry>, id: TerminalId, exitCode: number): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => (entry.id === id ? { ...entry, state: exitCode === 0 ? 'Done' : 'Error', exitCode } : entry));

/** A fresh Live process takes the place of an entry: same project, Tab, number and Provider, new id, no screen carried over. */
export const restarted = (entries: ReadonlyArray<TerminalEntry>, id: TerminalId, next: TerminalId): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => (entry.id === id ? { id: next, projectId: entry.projectId, tabId: entry.tabId, number: entry.number, state: 'Live', activity: 'Idle', ...(entry.provider === undefined ? {} : { provider: entry.provider }) } : entry));
