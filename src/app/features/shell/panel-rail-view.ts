import type { Notification, TerminalStatus } from '../../../shared/notification/notification.model';
import type { Project, ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import type { TerminalEntry, TerminalId } from '../workspace/terminal-entries';
import { PRIORITY, mascotStatus } from './pill-view';

/** A Terminal as a line of the Panel's rail. */
export interface RailRow {
  readonly id: TerminalId;
  /** The Project it runs in. */
  readonly projectId: ProjectId;
  readonly number: number;
  readonly status: TerminalStatus;
  /** A Done or Error the user has viewed: it no longer counts for the Mascot (GLOSSARY: Seen). */
  readonly seen: boolean;
  readonly projectName: string;
  /** The Provider it runs; absent for a plain shell. */
  readonly provider: Provider | undefined;
}

/** The Terminals that need the user come first, as one group; the rest are grouped by Project. */
export interface RailGroup {
  readonly key: string;
  readonly needsYou: boolean;
  /** The Project's name; empty for the group of Terminals that need the user, and while the Projects are not known. */
  readonly name: string;
  readonly rows: ReadonlyArray<RailRow>;
}

export interface RailTally {
  readonly status: TerminalStatus;
  readonly count: number;
}

export interface RailView {
  /** How many Terminals are in each status that says something (not Idle), most urgent first. */
  readonly tally: ReadonlyArray<RailTally>;
  readonly groups: ReadonlyArray<RailGroup>;
}

/** What asks for the user: a live agent stalled until they act, or a Terminal that failed. */
const NEEDS_YOU: ReadonlyArray<TerminalStatus> = ['Waiting', 'Error'];

/**
 * What the Panel's rail shows. A Terminal's status is its latest Notification, the same one the Mascot reads, so the
 * tally and the lines never disagree with it; a Terminal with none is Idle.
 */
export const railView = (
  entries: ReadonlyArray<TerminalEntry>,
  notifications: ReadonlyArray<Notification>,
  projects: ReadonlyArray<Project>,
): RailView => {
  const said = new Map(notifications.map((notification) => [notification.source.terminalId, notification]));
  const projectName = (projectId: ProjectId) => projects.find((project) => project.projectId === projectId)?.name ?? '';
  const lines = entries.map((entry) => ({
    projectId: entry.projectId,
    row: {
      id: entry.id,
      projectId: entry.projectId,
      number: entry.number,
      status: said.get(entry.id)?.type ?? 'Idle',
      seen: said.get(entry.id)?.seen ?? false,
      projectName: projectName(entry.projectId),
      provider: entry.provider,
    } satisfies RailRow,
  }));

  const needs = NEEDS_YOU.flatMap((status) => lines.filter((line) => line.row.status === status));
  const groups: RailGroup[] = needs.length === 0 ? [] : [{ key: 'needs-you', needsYou: true, name: '', rows: needs.map((line) => line.row) }];
  const rest = lines.filter((line) => !needs.includes(line));
  for (const projectId of new Set(rest.map((line) => line.projectId))) {
    groups.push({
      key: projectId,
      needsYou: false,
      name: projectName(projectId),
      rows: rest.filter((line) => line.projectId === projectId).map((line) => line.row),
    });
  }

  const tally = PRIORITY.filter((status) => status !== 'Idle')
    .map((status) => ({ status, count: notifications.filter((notification) => mascotStatus(notification) === status).length }))
    .filter((item) => item.count > 0);
  return { tally, groups };
};

/** The Terminal the Mascot is about: the first unseen one in the status it shows. Undefined while nothing says anything. */
export const urgentTerminal = (view: RailView, status: TerminalStatus): TerminalId | undefined =>
  status === 'Idle' ? undefined : view.groups.flatMap((group) => group.rows).find((row) => !row.seen && row.status === status)?.id;
