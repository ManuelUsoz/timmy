import { app, screen, systemPreferences } from 'electron';
import { Effect, Layer, Queue, Stream } from 'effect';
import { restoredBounds, type WindowPoint } from '../../src/shared/window/window.model';
import { appWindow, rememberPlan } from './app-window';
import { makeBoundsAnimator } from './bounds-animator';
import { WindowHost } from './window-service';

const animator = makeBoundsAnimator();

/** About 30 Hz: smooth enough for a gaze that eases between samples, cheap enough to poll from main. */
const CURSOR_POLL_INTERVAL = '33 millis';

/**
 * The e2e app has no cursor of its own to follow: the real one is wherever the machine's is, which would move the eyes in
 * every screenshot. A spec sets `timmyE2eCursor` (a point on the desktop) from the main process instead, and until it does
 * nothing is reported.
 */
const e2e = process.env['TIMMY_E2E'] === '1';
const desktopCursor = (): { readonly x: number; readonly y: number } | undefined =>
  e2e ? (globalThis as { timmyE2eCursor?: { x: number; y: number } }).timmyE2eCursor : screen.getCursorScreenPoint();

/**
 * The cursor in the window's own coordinates, from the top-left of its content. The renderer compares it with where the
 * Mascot is drawn, and `window.screenX` is not that origin on every platform (Windows counts an invisible resize border).
 * Because it is relative, it also changes while the window moves under a still cursor.
 */
const readCursor = (): WindowPoint | undefined => {
  const win = appWindow();
  const cursor = desktopCursor();
  if (!win || !cursor) return undefined;
  const content = win.getContentBounds();
  return { x: cursor.x - content.x, y: cursor.y - content.y };
};

const sameCursor = (a: WindowPoint, b: WindowPoint): boolean => a.x === b.x && a.y === b.y;

export const layerElectronWindowHost: Layer.Layer<WindowHost> = Layer.succeed(WindowHost, {
  workArea: Effect.sync(() => {
    const win = appWindow();
    return (win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()).workArea;
  }),
  close: Effect.sync(() => app.quit()),
  minimize: Effect.sync(() => appWindow()?.minimize()),
  toggleMaximize: Effect.sync(() => {
    const win = appWindow();
    if (!win?.isMaximizable()) return; // Pill and Panel are not maximizable
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }),
  maximized: Stream.callback<boolean>((queue) =>
    Effect.gen(function* () {
      const win = appWindow();
      if (!win) return void Queue.offerUnsafe(queue, false);
      const push = () => void Queue.offerUnsafe(queue, win.isMaximized());
      push();
      win.on('maximize', push);
      win.on('unmaximize', push);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          win.removeListener('maximize', push);
          win.removeListener('unmaximize', push);
        }),
      );
    }),
  ),
  visible: Stream.callback<boolean>((queue) =>
    Effect.gen(function* () {
      const win = appWindow();
      if (!win) return void Queue.offerUnsafe(queue, false);
      const push = () => void Queue.offerUnsafe(queue, win.isVisible() && !win.isMinimized());
      push();
      win.on('show', push);
      win.on('hide', push);
      win.on('minimize', push);
      win.on('restore', push);
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          win.removeListener('show', push);
          win.removeListener('hide', push);
          win.removeListener('minimize', push);
          win.removeListener('restore', push);
        }),
      );
    }),
  ).pipe(Stream.changes),
  // Polls only while somebody reads the stream: the service stops reading when the Mascot cannot be seen.
  cursor: Stream.tick(CURSOR_POLL_INTERVAL).pipe(
    Stream.map(readCursor),
    Stream.filter((point): point is WindowPoint => point !== undefined),
    Stream.changesWith(sameCursor),
  ),
  /** Starts the transition and returns; a later `apply` cancels it, so the window always ends at the latest plan. */
  apply: (plan) =>
    Effect.sync(() => {
      rememberPlan(plan);
      const win = appWindow();
      if (!win) return true; // the next window opens on this plan
      animator.cancel();
      // A maximized or minimized Expanded animates away from its restored bounds, never from the full screen.
      const from = restoredBounds({
        bounds: win.getBounds(),
        normalBounds: win.getNormalBounds(),
        maximized: win.isMaximized(),
      });
      if (win.isMinimized()) win.restore();
      if (win.isMaximized()) win.unmaximize();
      win.setBounds(from);
      const settle = () => {
        win.setMinimumSize(plan.minWidth, 0);
        win.setResizable(plan.resizable);
      };
      win.setAlwaysOnTop(plan.alwaysOnTop);
      win.setSkipTaskbar(plan.skipTaskbar);
      win.setMaximizable(plan.maximizable);
      win.setMinimumSize(0, 0); // a minimum would clamp the first frames of the animation
      win.setResizable(true);
      if (systemPreferences.getAnimationSettings().prefersReducedMotion) {
        win.setBounds(plan.bounds);
        settle();
        return true;
      }
      animator.animate(
        from,
        plan.bounds,
        (bounds) => {
          if (!win.isDestroyed()) win.setBounds(bounds);
        },
        () => {
          if (!win.isDestroyed()) settle();
        },
      );
      return true;
    }),
});
