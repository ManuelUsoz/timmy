import { Layer } from 'effect';
import { layerChatRpc } from '../chat/chat-rpc';
import { layerMockSdkAdapterRegistry } from '../chat/mock-sdk-adapter';
import { layerSdkAdapterRegistry } from '../chat/sdk-adapter-registry';
import { layerProjectResolver } from '../sessions/project-resolver';
import { layerSessionObserver } from '../sessions/session-observer';
import { layerSessionsService } from '../sessions/sessions-service';
import { layerAppInfoHandlers } from './app-info';
import { layerChatHandlers } from './chat';
import { layerSessionsHandlers } from './sessions';
import { layerWindowHandlers } from './window';
import { layerWindowService } from '../window/window-service';

/** `npm run e2e` runs the app against a scripted adapter, so no network or login is needed. */
const isE2e = process.env['TIMMY_E2E'] === '1';

/** The services chat and sessions share. Built once, so both see the same open sessions. */
const layerChatServices = layerChatRpc.pipe(
  Layer.provideMerge(Layer.mergeAll(isE2e ? layerMockSdkAdapterRegistry : layerSdkAdapterRegistry, layerProjectResolver, layerSessionObserver)),
);

const layerSessionHandlers = layerSessionsHandlers.pipe(Layer.provide(layerSessionsService));

const layerWindowHandlersLive = layerWindowHandlers.pipe(Layer.provide(layerWindowService));

/**
 * Handlers for every domain in `DesktopRpcs`. Merge new domain handler layers here.
 * Needs a `SessionRepo` and a `WindowHost`; the runtime provides the real ones.
 */
export const layerDesktopHandlers = Layer.mergeAll(
  layerAppInfoHandlers,
  layerChatHandlers,
  layerSessionHandlers,
  layerWindowHandlersLive,
).pipe(Layer.provide(layerChatServices));
