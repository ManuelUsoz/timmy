import { Layer } from 'effect';
import { layerProjectFiles } from '../files/project-files';
import { layerHooksService } from '../hooks/hooks-service';
import { layerProjectFolders } from '../projects/project-folders';
import { layerProjectsService } from '../projects/projects-service';
import { layerTerminalService } from '../terminal/terminal-service';
import { layerWindowService } from '../window/window-service';
import { layerAppInfoHandlers } from './app-info';
import { layerFilesHandlers } from './files';
import { layerHooksHandlers } from './hooks';
import { layerProjectsHandlers } from './projects';
import { layerSettingsHandlers } from './settings';
import { layerTerminalHandlers } from './terminal';
import { layerWindowHandlers } from './window';

const layerProjectsHandlersLive = layerProjectsHandlers.pipe(
  Layer.provide(layerProjectsService),
  Layer.provide(layerProjectFolders),
);

const layerFilesHandlersLive = layerFilesHandlers.pipe(Layer.provide(layerProjectFiles()));

const layerHooksHandlersLive = layerHooksHandlers.pipe(Layer.provide(layerHooksService));

const layerWindowHandlersLive = layerWindowHandlers.pipe(Layer.provide(layerWindowService));

/**
 * Handlers for every domain in `DesktopRpcs`. Merge new domain handler layers here.
 * Needs a `ProjectStore`, a `SettingsStore`, a `WindowHost`, a `FolderPicker`, the `HookIntegrations` and the `HookChannel`; the runtime provides the real ones.
 */
export const layerDesktopHandlers = Layer.mergeAll(
  layerAppInfoHandlers,
  layerWindowHandlersLive,
  layerSettingsHandlers,
  layerProjectsHandlersLive,
  layerFilesHandlersLive,
  layerHooksHandlersLive,
  layerTerminalHandlers.pipe(Layer.provide(layerTerminalService)),
);
