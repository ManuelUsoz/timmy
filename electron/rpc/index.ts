import { Layer } from 'effect';
import { layerAppInfoHandlers } from './app-info';

/** Handlers for every domain in `DesktopRpcs`. Merge new domain handler layers here. */
export const layerDesktopHandlers = Layer.mergeAll(layerAppInfoHandlers);
