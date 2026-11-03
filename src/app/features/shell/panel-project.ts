import type { Project } from '../../../shared/projects/projects.model';

/**
 * The Project the Panel opens a Terminal in: the one used last, else the first of the list. Undefined when there
 * are no Projects, which the Panel answers by sending the user to the Workspace to add one.
 */
export const panelProject = (projects: ReadonlyArray<Project>): Project | undefined => {
  let last: Project | undefined;
  for (const project of projects) {
    if (project.lastUsedAt !== null && (last === undefined || project.lastUsedAt > (last.lastUsedAt ?? 0))) last = project;
  }
  return last ?? projects[0];
};
