import { Effect } from 'effect';
import { WindowRpcs } from '../../src/shared/window/window.rpc';
import { WindowService } from '../window/window-service';

export const layerWindowHandlers = WindowRpcs.toLayer(
  Effect.gen(function* () {
    const windows = yield* WindowService;
    return {
      'Window.current': () => windows.current,
      'Window.request': ({ mode }) => windows.request(mode),
      'Window.close': () => windows.close,
      'Window.minimize': () => windows.minimize,
      'Window.toggleMaximize': () => windows.toggleMaximize,
      'Window.maximized': () => windows.maximized,
    };
  }),
);
