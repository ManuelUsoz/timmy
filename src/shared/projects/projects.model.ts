import { Schema } from 'effect';
import { ProjectId } from '../sessions/sessions.model';

/** A repository on disk that sessions belong to, as listed in the Workspace. */
export const Project = Schema.Struct({
  projectId: ProjectId,
  /** Absolute path of the folder, as the user added it. */
  cwd: Schema.String,
  /** What the user typed, or the name of the folder. */
  name: Schema.String,
  /** Epoch milliseconds. */
  createdAt: Schema.Number,
  /** Epoch milliseconds of the last time the user opened it; null if never. */
  lastUsedAt: Schema.NullOr(Schema.Number),
}).annotate({ identifier: 'Project' });
export type Project = typeof Project.Type;

/** What is known about a folder before it becomes a project. */
export const FolderInspection = Schema.Struct({
  path: Schema.String,
  /** The checked-out git branch; null when the folder is not a git repository. */
  branch: Schema.NullOr(Schema.String),
  /** The name of the project that already has this folder, if the user added it before. */
  existingName: Schema.NullOr(Schema.String),
}).annotate({ identifier: 'FolderInspection' });
export type FolderInspection = typeof FolderInspection.Type;

/** Whether the folder of a project is still on disk. */
export const FolderStatus = Schema.Literals(['Present', 'Missing']).annotate({ identifier: 'FolderStatus' });
export type FolderStatus = typeof FolderStatus.Type;
