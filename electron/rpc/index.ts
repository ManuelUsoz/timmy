import { Layer } from 'effect';
import { layerChatRpc } from '../chat/chat-rpc';
import { layerSdkAdapterRegistry } from '../chat/sdk-adapter-registry';
import { layerAppInfoHandlers } from './app-info';
import { layerChatHandlers } from './chat';

const layerChat = layerChatHandlers.pipe(
  Layer.provide(layerChatRpc),
  Layer.provide(layerSdkAdapterRegistry),
);

/** Handlers for every domain in `DesktopRpcs`. Merge new domain handler layers here. */
export const layerDesktopHandlers = Layer.mergeAll(layerAppInfoHandlers, layerChat);
