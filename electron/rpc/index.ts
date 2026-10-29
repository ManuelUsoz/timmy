import { Layer } from 'effect';
import { layerChatRpc } from '../chat/chat-rpc';
import { layerSdkAdapterRegistry } from '../chat/sdk-adapter-registry';
import { layerProjectResolver } from '../sessions/project-resolver';
import { layerSessionObserver } from '../sessions/session-observer';
import { layerSessionsService } from '../sessions/sessions-service';
import { layerAppInfoHandlers } from './app-info';
import { layerChatHandlers } from './chat';
import { layerSessionsHandlers } from './sessions';

/** The services chat and sessions share. Built once, so both see the same open sessions. */
const layerChatServices = layerChatRpc.pipe(
  Layer.provideMerge(Layer.mergeAll(layerSdkAdapterRegistry, layerProjectResolver, layerSessionObserver)),
);

const layerSessionHandlers = layerSessionsHandlers.pipe(Layer.provide(layerSessionsService));

/**
 * Handlers for every domain in `DesktopRpcs`. Merge new domain handler layers here.
 * Needs a `SessionRepo`; the runtime provides the on-disk one.
 */
export const layerDesktopHandlers = Layer.mergeAll(layerAppInfoHandlers, layerChatHandlers, layerSessionHandlers).pipe(
  Layer.provide(layerChatServices),
);
