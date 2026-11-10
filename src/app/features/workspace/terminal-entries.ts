import { TerminalId, type TerminalActivity, type TerminalActivityEntry } from '../../../shared/terminal/terminal.model';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { freeDefaultName } from '../../../shared/workspace/terminal-name';
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

/** A Terminal of a Project. Its identity, number, name, Provider and Tab are saved with the layout (ADR 0011); the rest is local to this run. */
export interface TerminalEntry {
  readonly id: TerminalId;
  readonly projectId: ProjectId;
  /** The Tab it is in (GLOSSARY: Tab). Closing that Tab closes it. */
  readonly tabId: TabId;
  /** The number its Project gave it when it was opened (shown as `#2`), never reused, kept across restarts (GLOSSARY: Terminal). */
  readonly number: number;
  /** Its name: the default one ("claude 2", "shell 2") until the user renames it. Unique in its Project, ignoring case. */
  readonly name: string;
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

/**
 * A new, Idle Terminal for the Project, in the given Tab, with its default name. It is numbered after `lastNumber` (the
 * highest number the Project has given, its closed Terminals included) and after every Terminal it has now.
 */
export const addTerminal = (
  entries: ReadonlyArray<TerminalEntry>,
  projectId: ProjectId,
  tabId: TabId,
  id: TerminalId,
  provider?: Provider,
  lastNumber = 0,
): ReadonlyArray<TerminalEntry> => {
  const siblings = terminalsOf(entries, projectId);
  const number = siblings.reduce((max, entry) => Math.max(max, entry.number), lastNumber) + 1;
  const name = freeDefaultName(siblings.map((entry) => entry.name), provider, number);
  return [...entries, { id, projectId, tabId, number, name, state: 'Idle', activity: 'Idle', ...(provider === undefined ? {} : { provider }) }];
};

/** The user renamed a Terminal. Whether the name is free is checked before (see `TerminalsState.rename`). */
export const withName = (entries: ReadonlyArray<TerminalEntry>, id: TerminalId, name: string): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => (entry.id === id ? { ...entry, name } : entry));

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

/** A fresh Live process takes the place of an entry: same project, Tab, number, name and Provider, new id, no screen carried over. */
export const restarted = (entries: ReadonlyArray<TerminalEntry>, id: TerminalId, next: TerminalId): ReadonlyArray<TerminalEntry> =>
  entries.map((entry) => (entry.id === id ? { id: next, projectId: entry.projectId, tabId: entry.tabId, number: entry.number, name: entry.name, state: 'Live', activity: 'Idle', ...(entry.provider === undefined ? {} : { provider: entry.provider }) } : entry));
