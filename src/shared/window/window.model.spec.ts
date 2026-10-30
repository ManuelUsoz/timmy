import { describe, expect, it } from 'vitest';
import { offeredModes, planFor, startupMode } from './window.model';

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

  it('centers Expanded at 900x700 in the work area, as a normal taskbar window', () => {
    expect(planFor('Expanded', workArea)).toEqual({
      mode: 'Expanded',
      bounds: { x: 510, y: 170, width: 900, height: 700 },
      alwaysOnTop: false,
      skipTaskbar: false,
      resizable: false,
    });
    expect(planFor('Expanded', { x: 1920, y: 40, width: 1280, height: 720 }).bounds).toEqual({
      x: 1920 + 190,
      y: 40 + 10,
      width: 900,
      height: 700,
    });
  });

  it('shrinks Expanded to fit a small work area', () => {
    const { bounds } = planFor('Expanded', { x: 0, y: 0, width: 800, height: 600 });
    expect(bounds).toEqual({ x: 0, y: 0, width: 800, height: 600 });
  });
});
