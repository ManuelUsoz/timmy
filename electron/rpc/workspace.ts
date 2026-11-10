import { Effect } from 'effect';
import { WorkspaceRpcs } from '../../src/shared/workspace/workspace.rpc';
import { ProjectStore } from '../projects/project-store';
import { QuitGate } from '../workspace/quit-gate';

export const layerWorkspaceHandlers = WorkspaceRpcs.toLayer(
  Effect.gen(function* () {
    const store = yield* ProjectStore;
    const gate = yield* QuitGate;
    return {
      'Workspace.load': () => store.layouts,
      'Workspace.save': ({ projectId, tabs, lastNumber }) => store.saveLayout(projectId, tabs, lastNumber),
      'Workspace.renameTerminal': ({ projectId, number, name }) => store.renameTerminal(projectId, number, name),
      'Workspace.quitting': () => gate.quitting,
      'Workspace.saved': () => gate.saved,
    };
  }),
);
