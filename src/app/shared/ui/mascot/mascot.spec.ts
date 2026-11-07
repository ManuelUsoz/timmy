import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import type { TerminalStatus } from '../../../../shared/notification/notification.model';
import { afterEach, vi } from 'vitest';
import { CursorState } from '../../../core/cursor-state';
import type { WindowPoint } from '../../../../shared/window/window.model';
import { PageVisibility } from '../../../core/page-visibility';
import { ReducedMotion } from '../../../core/reduced-motion';
import { MASCOT_CLOCK } from './mascot-clock';
import { HOP_FOR } from './mascot-hops';
import { STROKE_FOR } from './mascot-rally';
import { MascotComponent } from './mascot';

@Component({
  imports: [MascotComponent],
  template: `<ui-mascot [status]="status()" [size]="size" [label]="label" />`,
})
class Host {
  readonly status = signal<TerminalStatus>('Idle');
  size = 72;
  label = '';
}

/** A clock the spec moves by hand: timers fire as `advance` passes their time, and every draw of chance is `chance`. */
const makeClock = () => {
  let now = 0;
  let pending: Array<{ at: number; run: () => void; live: boolean }> = [];
  const clock = {
    chance: 0,
    /** How many times the Mascot has drawn a random number. */
    draws: 0,
    random: () => {
      clock.draws += 1;
      return clock.chance;
    },
    now: () => now,
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
  /** Whether the user asked for reduced motion. */
  const reduced = signal(false);
  let clock = makeClock();
  let shown: ComponentFixture<Host>;

  afterEach(() => {
    cursor.set(null);
    visible.set(true);
    clock = makeClock();
    vi.restoreAllMocks();
  });

  async function render({ status, ...patch }: Partial<Pick<Host, 'size' | 'label'> & { status: TerminalStatus }> = {}) {
    TestBed.resetTestingModule();
    const chance = clock.chance; // a spec sets the draw before it renders
    clock = makeClock();
    clock.chance = chance;
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: CursorState, useValue: { point: cursor.asReadonly() } },
        { provide: PageVisibility, useValue: { visible: visible.asReadonly() } },
        { provide: ReducedMotion, useValue: { reduced: reduced.asReadonly() } },
        { provide: MASCOT_CLOCK, useValue: clock },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    if (status) fixture.componentInstance.status.set(status);
    await fixture.whenStable();
    shown = fixture;
    return fixture.nativeElement.querySelector('ui-mascot') as HTMLElement;
  }

  /** Lets `ms` of time pass, then lets the Mascot redraw. */
  async function pass(ms: number) {
    clock.advance(ms);
    await shown.whenStable();
  }

  /** The aggregate status changes to `status`, as the Pill would pass it down. */
  async function turn(status: TerminalStatus) {
    shown.componentInstance.status.set(status);
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

    it('does not draw a new wait for every cursor sample', async () => {
      const el = await render();
      const drawn = clock.draws;
      for (let x = 1; x <= 20; x++) {
        cursor.set({ x, y: 0 });
        await pass(33);
      }
      expect(clock.draws).toBe(drawn);
      expect(el.style.getPropertyValue('--gaze-x')).not.toBe('');
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

  describe('hop', () => {
    const hop = (el: HTMLElement) => el.getAttribute('data-hop');

    it('hops after 10 s at the soonest while Working', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Working' });
      await pass(9999);
      expect(hop(el)).toBeNull();
      await pass(1);
      expect(hop(el)).toBe('hop');
    });

    it('hops every 15 s at the latest while Working', async () => {
      clock.chance = 0.9999;
      const el = await render({ status: 'Working' });
      await pass(14_999);
      expect(hop(el)).toBeNull();
      await pass(1);
      expect(hop(el)).toBe('hop');
    });

    it('plays a hop once, lands, and hops again later', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Working' });
      await pass(10_000);
      expect(hop(el)).toBe('hop');
      await pass(HOP_FOR.hop);
      expect(hop(el)).toBeNull();
      await pass(10_000 - HOP_FOR.hop);
      expect(hop(el)).toBe('hop');
    });

    it.each(['Done', 'Error'] as const)('hops every 20-40 s once %s', async (status) => {
      clock.chance = 0;
      const soon = await render({ status });
      await pass(19_999);
      expect(hop(soon)).toBeNull();
      await pass(1);
      expect(hop(soon)).toBe('hop');

      clock.chance = 0.99999;
      const late = await render({ status });
      await pass(39_999);
      expect(hop(late)).toBeNull();
      await pass(1);
      expect(hop(late)).toBe('hop');
    });

    it('never hops while Idle', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Idle' });
      for (let t = 0; t < 120; t++) {
        await pass(1000);
        expect(hop(el)).toBeNull();
      }
    });

    it.each(['Done', 'Error'] as const)('hops once at once when the status turns %s, then rests', async (status) => {
      clock.chance = 0.9999;
      const el = await render({ status: 'Working' });
      await turn(status);
      await pass(0);
      expect(hop(el)).toBe('hop');
      await pass(HOP_FOR.hop);
      expect(hop(el)).toBeNull();
      await pass(39_000);
      expect(hop(el)).toBeNull();
    });

    it('does not hop on entry for a status it already had when it was drawn', async () => {
      clock.chance = 0.9999;
      const el = await render({ status: 'Done' });
      await pass(0);
      expect(hop(el)).toBeNull();
    });

    it('double-hops when the status turns Waiting, then only pulses until it changes', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Working' });
      await turn('Waiting');
      await pass(0);
      expect(hop(el)).toBe('double');
      await pass(HOP_FOR.double);
      expect(hop(el)).toBeNull();
      for (let t = 0; t < 120; t++) {
        await pass(1000);
        expect(hop(el)).toBeNull();
      }
      expect(el.getAttribute('data-status')).toBe('Waiting');
    });

    it('stops the hops of a status it leaves', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Working' });
      await pass(9000);
      await turn('Idle');
      await pass(0);
      await pass(60_000);
      expect(hop(el)).toBeNull();
    });

    it('lands at once when the status changes mid-hop', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Working' });
      await pass(10_000);
      expect(hop(el)).toBe('hop');
      await turn('Idle');
      await pass(0);
      expect(hop(el)).toBeNull();
    });

    it('does not hop while the page is hidden, nor replay the entry hop when it shows again', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Working' });
      visible.set(false);
      await turn('Done');
      await pass(0);
      await pass(60_000);
      expect(hop(el)).toBeNull();
      visible.set(true);
      await pass(0);
      expect(hop(el)).toBeNull();
      await pass(20_000);
      expect(hop(el)).toBe('hop');
    });

    describe('under reduced motion', () => {
      afterEach(() => reduced.set(false));

      it('never hops, nor double-hops on Waiting', async () => {
        reduced.set(true);
        clock.chance = 0;
        const el = await render({ status: 'Working' });
        await pass(60_000);
        expect(hop(el)).toBeNull();
        await turn('Waiting');
        await pass(0);
        expect(hop(el)).toBeNull();
      });

      it('still blinks and glances', async () => {
        reduced.set(true);
        clock.chance = 0;
        const el = await render({ status: 'Working' });
        await pass(4000);
        expect(el.classList.contains('blinking')).toBe(true);
        await pass(1000);
        expect(el.style.getPropertyValue('--gaze-x')).toBe('-4');
      });
    });
  });

  describe('tennis rally', () => {
    const stroke = (el: HTMLElement) => el.getAttribute('data-rally');
    const racket = (el: HTMLElement) => el.querySelector('.racket');
    const ball = (el: HTMLElement) => el.querySelector('.ball');

    it('starts a rally after 30 s at the soonest while Idle, with a racket and a ball', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Idle' });
      await pass(29_999);
      expect(stroke(el)).toBeNull();
      expect(racket(el)).toBeNull();
      expect(ball(el)).toBeNull();
      await pass(1);
      expect(stroke(el)).not.toBeNull();
      expect(racket(el)).not.toBeNull();
      expect(ball(el)).not.toBeNull();
    });

    it('starts a rally after 60 s at the latest', async () => {
      clock.chance = 0.99999;
      const el = await render({ status: 'Idle' });
      await pass(59_999);
      expect(stroke(el)).toBeNull();
      await pass(1);
      expect(stroke(el)).not.toBeNull();
    });

    it('plays 2 strokes, forehand then backhand, then puts the racket and ball away', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Idle' });
      await pass(30_000);
      expect(stroke(el)).toBe('forehand');
      await pass(STROKE_FOR);
      expect(stroke(el)).toBe('backhand');
      await pass(STROKE_FOR);
      expect(stroke(el)).toBeNull();
      expect(racket(el)).toBeNull();
      expect(ball(el)).toBeNull();
    });

    it('plays 3 strokes, about 3 s, alternating sides when the draw says so', async () => {
      clock.chance = 0.9999;
      const el = await render({ status: 'Idle' });
      await pass(60_000);
      const strokes = [stroke(el)];
      await pass(STROKE_FOR);
      strokes.push(stroke(el));
      await pass(STROKE_FOR);
      strokes.push(stroke(el));
      expect(strokes).toEqual(['backhand', 'forehand', 'backhand']);
      await pass(STROKE_FOR);
      expect(stroke(el)).toBeNull();
    });

    it('holds a stroke as long as the clock does not move, so a frame can be frozen', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Idle' });
      await pass(30_000 + STROKE_FOR / 2);
      expect(stroke(el)).toBe('forehand');
      await pass(0);
      expect(stroke(el)).toBe('forehand');
      expect(racket(el)).not.toBeNull();
    });

    it('plays again 30-60 s after the rally ends', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Idle' });
      await pass(30_000);
      await pass(2 * STROKE_FOR);
      expect(stroke(el)).toBeNull();
      await pass(29_999);
      expect(stroke(el)).toBeNull();
      await pass(1);
      expect(stroke(el)).toBe('forehand');
    });

    it('waits the full 30-60 s again after a rally played on demand', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Idle' });
      await pass(29_000);
      (shown.debugElement.query(By.directive(MascotComponent)).componentInstance as MascotComponent).playRally();
      await pass(2 * STROKE_FOR);
      expect(stroke(el)).toBeNull();
      await pass(29_999);
      expect(stroke(el)).toBeNull();
      await pass(1);
      expect(stroke(el)).toBe('forehand');
    });

    it('keeps the body in its status color', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Idle' });
      await pass(30_000);
      expect(el.style.getPropertyValue('--tone')).toBe('var(--support-idle)');
    });

    it('follows the ball with its eyes, to the side of each stroke', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Idle' });
      await pass(30_000);
      expect(el.style.getPropertyValue('--gaze-x')).toBe('4');
      await pass(STROKE_FOR);
      expect(el.style.getPropertyValue('--gaze-x')).toBe('-4');
      await pass(STROKE_FOR);
      expect(el.style.getPropertyValue('--gaze-x')).toBe('0');
    });

    it.each(['Working', 'Waiting', 'Done', 'Error'] as const)('never plays while %s', async (status) => {
      clock.chance = 0;
      const el = await render({ status });
      for (let t = 0; t < 120; t++) {
        await pass(1000);
        expect(stroke(el)).toBeNull();
        expect(racket(el)).toBeNull();
      }
    });

    it('ends the game at once when the status changes mid-rally, and the new status moves', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Idle' });
      await pass(30_000);
      expect(stroke(el)).toBe('forehand');
      await turn('Waiting');
      await pass(0);
      expect(stroke(el)).toBeNull();
      expect(racket(el)).toBeNull();
      expect(ball(el)).toBeNull();
      expect(el.getAttribute('data-hop')).toBe('double');
    });

    it('does not play while the page is hidden, and ends a rally when it hides', async () => {
      clock.chance = 0;
      const el = await render({ status: 'Idle' });
      await pass(30_000);
      visible.set(false);
      await pass(0);
      expect(stroke(el)).toBeNull();
      await pass(120_000);
      expect(stroke(el)).toBeNull();
    });

    it('plays on demand only where it could play on its own', async () => {
      const mascot = () => shown.debugElement.query(By.directive(MascotComponent)).componentInstance as MascotComponent;
      const working = await render({ status: 'Working' });
      mascot().playRally();
      await pass(0);
      expect(stroke(working)).toBeNull();

      const idle = await render({ status: 'Idle' });
      mascot().playRally();
      await pass(0);
      expect(stroke(idle)).not.toBeNull();
    });

    describe('under reduced motion', () => {
      afterEach(() => reduced.set(false));

      it('never shows the game, not even a still racket', async () => {
        reduced.set(true);
        clock.chance = 0;
        const el = await render({ status: 'Idle' });
        for (let t = 0; t < 120; t++) {
          await pass(1000);
          expect(stroke(el)).toBeNull();
          expect(racket(el)).toBeNull();
          expect(ball(el)).toBeNull();
        }
      });
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
