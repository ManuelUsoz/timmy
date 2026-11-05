import type { Effect, Stream } from 'effect';
import { Context } from 'effect';
import type { RpcClient, RpcClientError } from 'effect/rpc';
import type { DesktopRpcs } from '../../shared/rpc/desktop-rpcs';
import type { Provider } from '../../shared/settings/settings.model';
import type { TerminalError } from '../../shared/terminal/terminal-error.model';
import type { TerminalActivityEntry, TerminalEvent, TerminalId } from '../../shared/terminal/terminal.model';

/** The typed RPC client for everything the renderer may ask the desktop shell. */
type TerminalApiShape = {
  readonly 'Terminal.create': (payload: { readonly cwd: string; readonly provider?: Provider }) => Effect.Effect<{ readonly terminalId: TerminalId }, TerminalError | RpcClientError.RpcClientError>;
  readonly 'Terminal.output': (payload: { readonly terminalId: TerminalId }) => Stream.Stream<TerminalEvent, TerminalError | RpcClientError.RpcClientError>;
  readonly 'Terminal.activity': () => Stream.Stream<ReadonlyArray<TerminalActivityEntry>, RpcClientError.RpcClientError>;
  readonly 'Terminal.focus': (payload: { readonly terminalId: TerminalId }) => Effect.Effect<void, TerminalError | RpcClientError.RpcClientError>;
  readonly 'Terminal.show': (payload: { readonly terminalId?: TerminalId }) => Effect.Effect<void, RpcClientError.RpcClientError>;
  readonly 'Terminal.write': (payload: { readonly terminalId: TerminalId; readonly data: string }) => Effect.Effect<void, TerminalError | RpcClientError.RpcClientError>;
  readonly 'Terminal.resize': (payload: { readonly terminalId: TerminalId; readonly cols: number; readonly rows: number }) => Effect.Effect<void, TerminalError | RpcClientError.RpcClientError>;
  readonly 'Terminal.close': (payload: { readonly terminalId: TerminalId }) => Effect.Effect<void, TerminalError | RpcClientError.RpcClientError>;
};

export type DesktopApiShape = RpcClient.FromGroup<typeof DesktopRpcs, RpcClientError.RpcClientError> & TerminalApiShape;

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
