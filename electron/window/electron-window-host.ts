import { app, screen, systemPreferences } from 'electron';
import { Effect, Layer } from 'effect';
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
  /** Starts the transition and returns; a later `apply` cancels it, so the window always ends at the latest plan. */
  apply: (plan) =>
    Effect.sync(() => {
      rememberPlan(plan);
      const win = appWindow();
      if (!win) return true; // the next window opens on this plan
      animator.cancel();
      const settle = () => win.setResizable(plan.resizable);
      win.setAlwaysOnTop(plan.alwaysOnTop);
      win.setSkipTaskbar(plan.skipTaskbar);
      win.setResizable(true);
      if (systemPreferences.getAnimationSettings().prefersReducedMotion) {
        win.setBounds(plan.bounds);
        settle();
        return true;
      }
      animator.animate(
        win.getBounds(),
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
