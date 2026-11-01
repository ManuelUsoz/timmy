import { app, screen, systemPreferences } from 'electron';
import { Effect, Layer, Queue, Stream } from 'effect';
import { restoredBounds } from '../../src/shared/window/window.model';
import { appWindow, rememberPlan } from './app-window';
import { makeBoundsAnimator } from './bounds-animator';
import { WindowHost } from './window-service';

const animator = makeBoundsAnimator();

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
