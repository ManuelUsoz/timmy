import type { TerminalStatus } from '../../../shared/notification/notification.model';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { RailView } from '../shell/panel-rail-view';
import { mostUrgent } from '../shell/pill-view';

/** What a Project's row in the sidebar says about its Terminals: how many there are, and the most urgent status among them. */
export interface ProjectTally {
  readonly count: number;
  readonly status: TerminalStatus;
}

/** The tally of every Project that has Terminals, from the same view the Terminals list draws, so the two never disagree. */
export const projectTallies = (view: RailView): ReadonlyMap<ProjectId, ProjectTally> => {
  const statuses = new Map<ProjectId, TerminalStatus[]>();
  for (const row of view.groups.flatMap((group) => group.rows)) {
    statuses.set(row.projectId, [...(statuses.get(row.projectId) ?? []), row.status]);
  }
  return new Map(Array.from(statuses, ([projectId, list]) => [projectId, { count: list.length, status: mostUrgent(list) ?? 'Idle' }]));
};
