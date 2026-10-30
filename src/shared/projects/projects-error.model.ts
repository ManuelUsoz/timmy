import { Schema } from 'effect';

/** Failures a caller can act on. Storage failures are defects. */
export class ProjectsError extends Schema.TaggedError<ProjectsError>()('ProjectsError', {
  reason: Schema.Literals([
    'ProjectNotFound',
    'AlreadyAdded',
    'FolderNotFound',
    'NotAGitRepository',
    'GitUnavailable',
    'GitInitFailed',
  ]),
  detail: Schema.String,
}) {}
