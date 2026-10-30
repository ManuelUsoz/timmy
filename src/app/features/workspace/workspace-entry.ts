import type { SessionId } from '../../../shared/chat/ids.model';
import type { Project } from '../../../shared/projects/projects.model';
import type { ProjectId } from '../../../shared/sessions/sessions.model';

/** What the Workspace opens: a project, and one of its sessions if there is one to show. */
export interface EntryTarget {
  readonly projectId: ProjectId;
  readonly sessionId?: SessionId;
}

/** The session the Panel has open, with the project it belongs to. */
export interface PanelSession {
  readonly projectId: ProjectId;
  readonly sessionId: SessionId;
}

/**
 * Where entering `/projects` leads: the live session of the Panel, else the project used last, else nowhere
 * (the list stays without a selection, or the empty state when there are no projects). A Panel session whose
 * project is not in the list does not count.
 */
export const entryTarget = (projects: ReadonlyArray<Project>, panel: PanelSession | undefined): EntryTarget | undefined => {
  if (panel !== undefined && projects.some((project) => project.projectId === panel.projectId)) {
    return { projectId: panel.projectId, sessionId: panel.sessionId };
  }
  let last: Project | undefined;
  for (const project of projects) {
    if (project.lastUsedAt !== null && (last === undefined || project.lastUsedAt > (last.lastUsedAt ?? 0))) last = project;
  }
  return last === undefined ? undefined : { projectId: last.projectId };
};

/** The router path of a target. */
export const entryPath = (target: EntryTarget): ReadonlyArray<string> =>
  target.sessionId === undefined
    ? ['/projects', target.projectId]
    : ['/projects', target.projectId, 'sessions', target.sessionId];
