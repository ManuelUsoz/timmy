import { Context } from 'effect';
import type { RpcClient, RpcClientError } from 'effect/rpc';
import type { DesktopRpcs } from '../../shared/rpc/desktop-rpcs';

/** The typed RPC client for everything the renderer may ask the desktop shell. */
export type DesktopApiShape = RpcClient.FromGroup<typeof DesktopRpcs, RpcClientError.RpcClientError>;

/**
 * Service boundary between the Angular app and Electron.
 *
 * Components and feature code depend on this tag, never on `window.desktop`
 * directly. Tests provide `makeDesktopTestLayer(...)` instead of mocking the
 * preload bridge.
 */
export class DesktopApi extends Context.Service<DesktopApi, DesktopApiShape>()(
  'renderer/DesktopApi',
) {}
