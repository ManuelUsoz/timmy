import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { TerminalStatus } from '../../../../shared/notification/notification.model';
import { afterEach, vi } from 'vitest';
import { CursorState } from '../../../core/cursor-state';
import type { WindowPoint } from '../../../../shared/window/window.model';
import { MascotComponent } from './mascot';

@Component({
  imports: [MascotComponent],
  template: `<ui-mascot [status]="status" [size]="size" [label]="label" />`,
})
class Host {
  status: TerminalStatus = 'Idle';
  size = 72;
  label = '';
}

describe('MascotComponent', () => {
  /** Where main says the cursor is. */
  const cursor = signal<WindowPoint | null>(null);

  afterEach(() => {
    cursor.set(null);
    vi.restoreAllMocks();
  });

  async function render(patch: Partial<Host> = {}) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [Host], providers: [{ provide: CursorState, useValue: { point: cursor.asReadonly() } }] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('ui-mascot') as HTMLElement;
  }

  const tones: ReadonlyArray<[TerminalStatus, string]> = [
    ['Working', 'success'],
    ['Waiting', 'info'],
    ['Error', 'error'],
    ['Done', 'merged'],
    ['Idle', 'idle'],
  ];

  it.each(tones)('colors a %s Mascot with the %s tone', async (status, tone) => {
    const el = await render({ status });
    expect(el.style.getPropertyValue('--tone')).toBe(`var(--support-${tone})`);
    expect(el.getAttribute('data-status')).toBe(status);
  });

  it('draws the Mascot at the size asked', async () => {
    const svg = (await render({ size: 72 })).querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('72');
    expect(svg.getAttribute('height')).toBe('72');
  });

  it('has different eyes for the statuses that look different', async () => {
    const eyes = async (status: TerminalStatus) => (await render({ status })).querySelector('.eyes')!.innerHTML;
    const looks = new Set([await eyes('Working'), await eyes('Error'), await eyes('Done')]);
    expect(looks.size).toBe(3);
  });

  describe('gaze', () => {
    const gaze = (el: HTMLElement) => ({ x: el.style.getPropertyValue('--gaze-x'), y: el.style.getPropertyValue('--gaze-y') });

    it('looks straight ahead until it knows where the cursor is', async () => {
      expect(gaze(await render())).toEqual({ x: '0', y: '0' });
    });

    it('moves its eyes toward a cursor on either side', async () => {
      cursor.set({ x: 800, y: 0 });
      expect(gaze(await render())).toEqual({ x: '4', y: '0' });
      cursor.set({ x: -800, y: 0 });
      expect(gaze(await render())).toEqual({ x: '-4', y: '0' });
    });

    it('looks from where it is drawn in the window, not from the corner of the window', async () => {
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ left: 100, top: 50, width: 72, height: 72 } as DOMRect);
      // Its center is at (136, 86) in the window; the cursor is in the same coordinates.
      cursor.set({ x: 236, y: 86 });
      expect(gaze(await render())).toEqual({ x: '2', y: '0' });
      cursor.set({ x: 136, y: -14 });
      expect(gaze(await render())).toEqual({ x: '0', y: '-2' });
    });

    it('keeps the eyes in a group of their own, so the status animations do not fight the gaze', async () => {
      for (const status of ['Idle', 'Working', 'Waiting', 'Done', 'Error'] as const) {
        const el = await render({ status });
        expect(el.querySelector('.gaze .eyes'), status).not.toBeNull();
      }
    });
  });

  it('is decorative unless it has a label, which makes it an image', async () => {
    expect((await render()).getAttribute('aria-hidden')).toBe('true');
    const labelled = await render({ label: 'Timmy: Working' });
    expect(labelled.getAttribute('role')).toBe('img');
    expect(labelled.getAttribute('aria-label')).toBe('Timmy: Working');
    expect(labelled.getAttribute('aria-hidden')).toBeNull();
  });
});
