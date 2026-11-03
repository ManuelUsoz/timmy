import type { Project } from '../../../shared/projects/projects.model';
import type { ProjectId } from '../../../shared/sessions/sessions.model';

/** What the Workspace opens: a project. */
export interface EntryTarget {
  readonly projectId: ProjectId;
}

/**
 * Where entering `/projects` leads: the project used last, else nowhere (the list stays without a selection,
 * or the empty state when there are no projects).
 */
export const entryTarget = (projects: ReadonlyArray<Project>): EntryTarget | undefined => {
  let last: Project | undefined;
  for (const project of projects) {
    if (project.lastUsedAt !== null && (last === undefined || project.lastUsedAt > (last.lastUsedAt ?? 0))) last = project;
  }
  return last === undefined ? undefined : { projectId: last.projectId };
};

/** The router path of a target. */
export const entryPath = (target: EntryTarget): ReadonlyArray<string> => ['/projects', target.projectId];
