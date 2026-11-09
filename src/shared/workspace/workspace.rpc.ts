import { Schema } from 'effect';
import { Rpc, RpcGroup } from 'effect/rpc';
import { ProjectId } from '../projects/projects.model';
import { ProjectLayout, SavedTab } from './workspace.model';

/** What of the Workspace outlives a restart (ADR 0011): the Tabs of each Project, their layout and their Terminals. Storage failures are defects. */
export const WorkspaceRpcs = RpcGroup.make(
  /** The saved Tabs of every listed Project; a Project with none is left out. */
  Rpc.make('Workspace.load', { success: Schema.Array(ProjectLayout) }),
  /** Saves the Project's Tabs as they are now, in place of what was saved. Terminals no longer in them are deleted from the store. */
  Rpc.make('Workspace.save', { payload: { projectId: ProjectId, tabs: Schema.Array(SavedTab) }, success: Schema.Void }),
);
