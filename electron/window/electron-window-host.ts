import { BrowserWindow, screen, systemPreferences } from 'electron';
import { Effect, Layer } from 'effect';
import { makeBoundsAnimator } from './bounds-animator';
import { WindowHost } from './window-service';

/** The first window is the app window; there is only one (ADR 0004). */
const appWindow = (): BrowserWindow | undefined => BrowserWindow.getAllWindows()[0];

const animator = makeBoundsAnimator();

export const layerElectronWindowHost: Layer.Layer<WindowHost> = Layer.succeed(WindowHost, {
  workArea: Effect.sync(() => {
    const win = appWindow();
    return (win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()).workArea;
  }),
  /** Starts the transition and returns; a later `apply` cancels it, so the window always ends at the latest plan. */
  apply: (plan) =>
    Effect.sync(() => {
      const win = appWindow();
      if (!win) return;
      animator.cancel();
      const settle = () => win.setResizable(plan.resizable);
      win.setAlwaysOnTop(plan.alwaysOnTop);
      win.setSkipTaskbar(plan.skipTaskbar);
      win.setResizable(true);
      if (systemPreferences.getAnimationSettings().prefersReducedMotion) {
        win.setBounds(plan.bounds);
        settle();
        return;
      }
      animator.animate(win.getBounds(), plan.bounds, (bounds) => win.setBounds(bounds), settle);
    }),
});
