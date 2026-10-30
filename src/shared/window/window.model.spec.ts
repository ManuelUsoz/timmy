import { describe, expect, it } from 'vitest';
import { offeredModes, planFor, startupMode } from './window.model';

const workArea = { x: 0, y: 0, width: 1920, height: 1040 };

describe('window modes', () => {
  it('starts in the Pill', () => {
    expect(startupMode).toBe('Pill');
  });

  it('offers the modes the user is not in', () => {
    expect(offeredModes('Pill')).toEqual(['Panel']);
    expect(offeredModes('Panel')).toEqual(['Pill']);
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
});
