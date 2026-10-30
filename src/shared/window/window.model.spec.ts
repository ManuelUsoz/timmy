import { describe, expect, it } from 'vitest';
import { offeredModes, planFor, restoredBounds, startupMode } from './window.model';

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe('window modes', () => {
  it('starts in the Pill', () => {
    expect(startupMode).toBe('Pill');
  });

  it('offers the modes the user is not in', () => {
    expect(offeredModes('Pill')).toEqual(['Panel', 'Expanded']);
    expect(offeredModes('Panel')).toEqual(['Pill', 'Expanded']);
    expect(offeredModes('Expanded')).toEqual(['Pill', 'Panel']);
  });

  it('anchors Pill and Panel at the bottom-right of the work area', () => {
    const pill = planFor('Pill', workArea);
    const panel = planFor('Panel', workArea);
    expect(pill.bounds.x + pill.bounds.width).toBe(1920 - 16);
    expect(pill.bounds.y + pill.bounds.height).toBe(1040 - 16);
    expect(panel.bounds.x + panel.bounds.width).toBe(pill.bounds.x + pill.bounds.width);
    expect(panel.bounds.y + panel.bounds.height).toBe(pill.bounds.y + pill.bounds.height);
  });

  it('respects a work area that does not start at the origin', () => {
    const plan = planFor('Pill', { x: 1920, y: 40, width: 1280, height: 720 });
    expect(plan.bounds.x + plan.bounds.width).toBe(1920 + 1280 - 16);
    expect(plan.bounds.y + plan.bounds.height).toBe(40 + 720 - 16);
  });

  it('makes Pill and Panel frameless-style: on top, off the taskbar, not resizable', () => {
    for (const mode of ['Pill', 'Panel'] as const) {
      expect(planFor(mode, workArea)).toMatchObject({ alwaysOnTop: true, skipTaskbar: true, resizable: false });
    }
  });

  it('opens Expanded at 1280x800, centered, as a resizable and maximizable taskbar window with a minimum of 800 wide', () => {
    expect(planFor('Expanded', workArea)).toEqual({
      mode: 'Expanded',
      bounds: { x: 320, y: 120, width: 1280, height: 800 },
      alwaysOnTop: false,
      skipTaskbar: false,
      resizable: true,
      maximizable: true,
      minWidth: 800,
      titleBarOverlay: true,
    });
    expect(planFor('Expanded', { x: 1920, y: 40, width: 1600, height: 900 }).bounds).toEqual({
      x: 1920 + 160,
      y: 40 + 50,
      width: 1280,
      height: 800,
    });
  });

  it('clamps Expanded to 90 % of the work area', () => {
    expect(planFor('Expanded', { x: 0, y: 0, width: 1366, height: 728 }).bounds).toEqual({
      x: 69,
      y: 37,
      width: 1229,
      height: 655,
    });
  });

  it('never lets Expanded go under its minimum width, nor over a tiny work area', () => {
    expect(planFor('Expanded', { x: 0, y: 0, width: 880, height: 600 }).bounds.width).toBe(800);
    expect(planFor('Expanded', { x: 0, y: 0, width: 700, height: 600 }).bounds).toMatchObject({ x: 0, width: 700 });
  });

  it('gives Pill and Panel no title bar overlay, no minimum and no maximize', () => {
    for (const mode of ['Pill', 'Panel'] as const) {
      expect(planFor(mode, workArea)).toMatchObject({ titleBarOverlay: false, maximizable: false, minWidth: 0 });
    }
  });
});

describe('restoredBounds', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1040 };
  const normal = { x: 320, y: 120, width: 1280, height: 800 };

  it('is the normal (restored) bounds while maximized, so leaving Expanded animates from them', () => {
    expect(restoredBounds({ bounds, normalBounds: normal, maximized: true })).toEqual(normal);
  });

  it('is the current bounds when not maximized', () => {
    expect(restoredBounds({ bounds: normal, normalBounds: normal, maximized: false })).toEqual(normal);
    expect(restoredBounds({ bounds: { ...normal, x: 5 }, normalBounds: normal, maximized: false }).x).toBe(5);
  });
});
