import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { ProjectId } from '../sessions/sessions.model';
import { Project, FolderInspection, FolderStatus } from './projects.model';
import { ProjectsError } from './projects-error.model';

/** The Projects the user manages in the Workspace. Storage failures are defects. */
export const ProjectsRpcs = RpcGroup.make(
  /** Added projects, in no particular order. */
  Rpc.make('Projects.list', { success: Schema.Array(Project) }),

  /**
   * Adds the folder as a project. It must be a git repository. A folder removed earlier comes back
   * with its sessions. Fails with `AlreadyAdded` when it is already in the list.
   */
  Rpc.make('Projects.add', {
    payload: { path: Schema.String, name: Schema.optionalKey(Schema.String) },
    success: Project,
    error: ProjectsError,
  }),

  /** Takes the project out of the list. Its sessions are kept and come back if the folder is added again. */
  Rpc.make('Projects.remove', {
    payload: { projectId: ProjectId },
    success: Schema.Void,
    error: ProjectsError,
  }),

  /** Opens the system folder picker; null when the user cancels. */
  Rpc.make('Projects.pickFolder', { success: Schema.NullOr(Schema.String) }),

  /** Looks at a folder: whether it is a git repository, on which branch, and whether it is already a project. */
  Rpc.make('Projects.inspectFolder', {
    payload: { path: Schema.String },
    success: FolderInspection,
    error: ProjectsError,
  }),

  /** `git init` without an initial commit. Fails with `GitUnavailable` when git is not installed. */
  Rpc.make('Projects.initGit', {
    payload: { path: Schema.String },
    success: FolderInspection,
    error: ProjectsError,
  }),

  /** Whether the folder of the project is still on disk. */
  Rpc.make('Projects.checkFolder', {
    payload: { projectId: ProjectId },
    success: FolderStatus,
    error: ProjectsError,
  }),

  /** Remembers the project as the last one the user opened. */
  Rpc.make('Projects.markUsed', {
    payload: { projectId: ProjectId },
    success: Schema.Void,
    error: ProjectsError,
  }),
);
