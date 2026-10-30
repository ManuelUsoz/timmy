import { app, BrowserWindow, screen } from 'electron';
import { Effect, Layer } from 'effect';
import { WindowHost } from './window-service';

/** The first window is the app window; there is only one (ADR 0004). */
const appWindow = (): BrowserWindow | undefined => BrowserWindow.getAllWindows()[0];

export const layerElectronWindowHost: Layer.Layer<WindowHost> = Layer.succeed(WindowHost, {
  workArea: Effect.sync(() => {
    const win = appWindow();
    return (win ? screen.getDisplayMatching(win.getBounds()) : screen.getPrimaryDisplay()).workArea;
  }),
  close: Effect.sync(() => app.quit()),
  apply: (plan) =>
    Effect.sync(() => {
      const win = appWindow();
      if (!win) return;
      win.setResizable(true);
      win.setBounds(plan.bounds);
      win.setResizable(plan.resizable);
      win.setAlwaysOnTop(plan.alwaysOnTop);
      win.setSkipTaskbar(plan.skipTaskbar);
    }),
});
