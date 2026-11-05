import { TestBed } from '@angular/core/testing';
import { Effect, Layer, PubSub, Stream } from 'effect';
import { AppInfoRpcs } from '../../shared/app-info/app-info.rpc';
import type { WindowPoint } from '../../shared/window/window.model';
import { WindowRpcs } from '../../shared/window/window.rpc';
import { CursorState } from './cursor-state';
import { layerFilesUnused, layerProjectsUnused, layerSettingsUnused, makeDesktopTestLayer } from './desktop-layers';
import { EffectRuntime } from './effect-runtime';

const unused = () => Effect.die('handler not under test');

/** The real client against a main that pushes the cursor positions the test publishes. */
const setup = () => {
  const positions = Effect.runSync(PubSub.unbounded<WindowPoint>());
  const layer = makeDesktopTestLayer(
    Layer.mergeAll(
      WindowRpcs.toLayer({
        'Window.current': unused,
        'Window.request': unused,
        'Window.close': unused,
        'Window.minimize': unused,
        'Window.toggleMaximize': unused,
        'Window.maximized': () => Stream.empty,
        'Window.cursor': () => Stream.fromPubSub(positions),
      }),
      AppInfoRpcs.toLayer({ 'AppInfo.get': unused }),
      layerFilesUnused,
      layerProjectsUnused,
      layerSettingsUnused,
    ),
  );
  TestBed.configureTestingModule({
    providers: [{ provide: EffectRuntime, useValue: { run: (effect: Effect.Effect<unknown, unknown, never>) => Effect.runPromiseExit(Effect.provide(effect as never, layer)) } }],
  });
  const publish = (point: WindowPoint) => Effect.runPromise(PubSub.publish(positions, point).pipe(Effect.asVoid));
  const tick = () => new Promise((resolve) => setTimeout(resolve, 20));
  return { cursor: TestBed.inject(CursorState), publish, tick };
};

describe('CursorState', () => {
  it('knows no position until main reports one', async () => {
    const { cursor, tick } = setup();
    await tick();
    expect(cursor.point()).toBeNull();
  });

  it('follows the positions main pushes, wherever on the desktop they are', async () => {
    const { cursor, publish, tick } = setup();
    await tick();
    await publish({ x: 300, y: 200 });
    await tick();
    expect(cursor.point()).toEqual({ x: 300, y: 200 });
    await publish({ x: -1500, y: 90 });
    await tick();
    expect(cursor.point()).toEqual({ x: -1500, y: 90 });
  });
});
