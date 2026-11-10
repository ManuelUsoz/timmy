import { Schema } from 'effect';

/** A Terminal name the user chose that cannot be used: taken by another Terminal of the Project (any case), or blank. */
export class WorkspaceError extends Schema.TaggedError<WorkspaceError>()('WorkspaceError', {
  reason: Schema.Literals(['NameTaken', 'NameEmpty']),
  detail: Schema.String,
}) {}
