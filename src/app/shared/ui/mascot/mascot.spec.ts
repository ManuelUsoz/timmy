import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type { TerminalStatus } from '../../../../shared/notification/notification.model';
import { afterEach, vi } from 'vitest';
import { CursorState } from '../../../core/cursor-state';
import type { WindowPoint } from '../../../../shared/window/window.model';
import { PageVisibility } from '../../../core/page-visibility';
import { MASCOT_CLOCK } from './mascot-clock';
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

/** A clock the spec moves by hand: timers fire as `advance` passes their time, and every draw of chance is `chance`. */
const makeClock = () => {
  let now = 0;
  let pending: Array<{ at: number; run: () => void; live: boolean }> = [];
  const clock = {
    chance: 0,
    random: () => clock.chance,
    after: (ms: number, run: () => void) => {
      const timer = { at: now + ms, run, live: true };
      pending.push(timer);
      return () => {
        timer.live = false;
      };
    },
    advance: (ms: number) => {
      const end = now + ms;
      for (;;) {
        const due = pending.filter((t) => t.live && t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        now = due.at;
        due.live = false;
        due.run();
      }
      now = end;
      pending = pending.filter((t) => t.live);
    },
  };
  return clock;
};

describe('MascotComponent', () => {
  /** Where main says the cursor is. */
  const cursor = signal<WindowPoint | null>(null);
  /** Whether the page can be seen. */
  const visible = signal(true);
  let clock = makeClock();
  let shown: ComponentFixture<Host>;

  afterEach(() => {
    cursor.set(null);
    visible.set(true);
    clock = makeClock();
    vi.restoreAllMocks();
  });

  async function render(patch: Partial<Host> = {}) {
    TestBed.resetTestingModule();
    const chance = clock.chance; // a spec sets the draw before it renders
    clock = makeClock();
    clock.chance = chance;
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: CursorState, useValue: { point: cursor.asReadonly() } },
        { provide: PageVisibility, useValue: { visible: visible.asReadonly() } },
        { provide: MASCOT_CLOCK, useValue: clock },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    shown = fixture;
    return fixture.nativeElement.querySelector('ui-mascot') as HTMLElement;
  }

  /** Lets `ms` of time pass, then lets the Mascot redraw. */
  async function pass(ms: number) {
    clock.advance(ms);
    await shown.whenStable();
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

  describe('blink', () => {
    const blinking = (el: HTMLElement) => el.classList.contains('blinking');

    it('blinks after 4 s at the soonest', async () => {
      clock.chance = 0;
      const el = await render();
      await pass(3999);
      expect(blinking(el)).toBe(false);
      await pass(1);
      expect(blinking(el)).toBe(true);
    });

    it('blinks after 7 s at the latest', async () => {
      clock.chance = 0.9999;
      const el = await render();
      await pass(6999);
      expect(blinking(el)).toBe(false);
      await pass(1);
      expect(blinking(el)).toBe(true);
    });

    it('plays each blink once, rests, and blinks again later', async () => {
      clock.chance = 0;
      const el = await render();
      await pass(4000);
      expect(blinking(el)).toBe(true);
      await pass(1000);
      expect(blinking(el)).toBe(false);
      await pass(3000);
      expect(blinking(el)).toBe(true);
    });
  });

  describe('glance', () => {
    const gazeX = (el: HTMLElement) => el.style.getPropertyValue('--gaze-x');

    it('glances to the left once the cursor has been still for 5 s, and comes back', async () => {
      clock.chance = 0;
      const el = await render();
      await pass(4999);
      expect(gazeX(el)).toBe('0');
      await pass(1);
      expect(gazeX(el)).toBe('-4');
      await pass(1000);
      expect(gazeX(el)).toBe('0');
    });

    it('glances to the right when the draw says so', async () => {
      clock.chance = 0.9999;
      const el = await render();
      await pass(9000);
      expect(gazeX(el)).toBe('4');
    });

    it('returns to looking at the cursor', async () => {
      cursor.set({ x: 800, y: 0 });
      clock.chance = 0;
      const el = await render();
      expect(gazeX(el)).toBe('4');
      await pass(5000);
      expect(gazeX(el)).toBe('-4');
      await pass(1000);
      expect(gazeX(el)).toBe('4');
    });

    it('waits for the cursor to be still again whenever it moves', async () => {
      clock.chance = 0;
      const el = await render();
      await pass(4000);
      cursor.set({ x: 800, y: 0 });
      await pass(0);
      await pass(4999);
      expect(gazeX(el)).toBe('4');
      await pass(1);
      expect(gazeX(el)).toBe('-4');
    });

    it('glances once, then waits for another still stretch', async () => {
      clock.chance = 0;
      const el = await render();
      await pass(6000);
      expect(gazeX(el)).toBe('0');
      await pass(3999);
      expect(gazeX(el)).toBe('0');
      await pass(1);
      expect(gazeX(el)).toBe('-4');
    });
  });

  describe('when it cannot be seen', () => {
    const blinking = (el: HTMLElement) => el.classList.contains('blinking');

    it('does not blink or glance while the page is hidden', async () => {
      visible.set(false);
      clock.chance = 0;
      const el = await render();
      await pass(60_000);
      expect(blinking(el)).toBe(false);
      expect(el.style.getPropertyValue('--gaze-x')).toBe('0');
    });

    it('stops its timers when the page is hidden, and starts over when it shows again', async () => {
      clock.chance = 0;
      const el = await render();
      await pass(3000);
      visible.set(false);
      await pass(60_000);
      expect(blinking(el)).toBe(false);
      visible.set(true);
      await pass(0);
      await pass(3999);
      expect(blinking(el)).toBe(false);
      await pass(1);
      expect(blinking(el)).toBe(true);
    });

    it('rests when hidden in the middle of a blink', async () => {
      clock.chance = 0;
      const el = await render();
      await pass(4000);
      expect(blinking(el)).toBe(true);
      visible.set(false);
      await pass(0);
      expect(blinking(el)).toBe(false);
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
