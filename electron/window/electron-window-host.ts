import { app, screen, systemPreferences, type BrowserWindow } from 'electron';
import { Effect, Layer } from 'effect';
import { restoredBounds } from '../../src/shared/window/window.model';
import { appWindow, rememberPlan } from './app-window';
import { makeBoundsAnimator } from './bounds-animator';
import { titleBarOverlayFor } from './title-bar-overlay';
import { WindowHost } from './window-service';

const animator = makeBoundsAnimator();

export const layerElectronWindowHost: Layer.Layer<WindowHost> = Layer.succeed(WindowHost, {
  workArea: Effect.sync(() => {
    const win = appWindow();
    return (win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()).workArea;
  }),
  close: Effect.sync(() => app.quit()),
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
      showControls(win, plan.titleBarOverlay);
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

/** macOS draws traffic lights with `titleBarStyle: 'hidden'`; Windows and Linux draw the overlay. */
const showControls = (win: BrowserWindow, visible: boolean): void => {
  if (process.platform === 'darwin') win.setWindowButtonVisibility(visible);
  else win.setTitleBarOverlay(titleBarOverlayFor(visible));
};
