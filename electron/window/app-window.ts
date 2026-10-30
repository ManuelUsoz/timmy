import type { BrowserWindow } from 'electron';
import type { WindowPlan } from '../../src/shared/window/window.model';

/** The one app window (ADR 0004) and the plan it last followed, so a recreated window opens in the same mode. */
let current: BrowserWindow | undefined;
let lastPlan: WindowPlan | undefined;

export const appWindow = (): BrowserWindow | undefined => (current?.isDestroyed() ? undefined : current);
export const setAppWindow = (win: BrowserWindow | undefined): void => {
  current = win;
};
export const rememberPlan = (plan: WindowPlan): void => {
  lastPlan = plan;
};
export const plannedWindow = (): WindowPlan | undefined => lastPlan;
