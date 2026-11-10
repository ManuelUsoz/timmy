import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { ProjectId } from '../projects/projects.model';
import { WorkspaceError } from './workspace-error.model';
import { ProjectLayout, SavedTab } from './workspace.model';

/** What of the Workspace outlives a restart (ADR 0011): the Tabs of each Project, their layout and their Terminals. Storage failures are defects. */
export const WorkspaceRpcs = RpcGroup.make(
  /** The saved Tabs of every listed Project; a Project with none, whose Terminals were never numbered, is left out. */
  Rpc.make('Workspace.load', { success: Schema.Array(ProjectLayout) }),
  /**
   * Saves the Project's Tabs as they are now, in place of what was saved. Terminals no longer in them are deleted from the
   * store. `lastNumber` is the highest number the Project has given a Terminal; the store never lowers it.
   */
  Rpc.make('Workspace.save', {
    payload: { projectId: ProjectId, tabs: Schema.Array(SavedTab), lastNumber: Schema.Int },
    success: Schema.Void,
  }),
  /**
   * The user renames the Terminal with that number (`#2`) in the Project: its id changes with a restart in place, its
   * number does not. Refused (`NameTaken`) when another Terminal of the Project is called that, ignoring
   * case, and (`NameEmpty`) when the name is blank. The name is saved trimmed.
   */
  Rpc.make('Workspace.renameTerminal', {
    payload: { projectId: ProjectId, number: Schema.Int, name: Schema.String },
    success: Schema.Void,
    error: WorkspaceError,
  }),
  /**
   * Each time Timmy is about to quit. The window saves what it has not saved yet and answers with `Workspace.saved`;
   * Timmy waits for that answer, briefly, so a change made just before quitting is not lost.
   */
  Rpc.make('Workspace.quitting', { success: Schema.Literal('Quitting'), stream: true }),
  /** The window saved what it had: Timmy may quit. */
  Rpc.make('Workspace.saved', { success: Schema.Void }),
);
