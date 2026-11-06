import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import type { TerminalStatus } from '../../../../shared/notification/notification.model';
import { CursorState } from '../../../core/cursor-state';
import { PageVisibility } from '../../../core/page-visibility';
import { ReducedMotion } from '../../../core/reduced-motion';
import type { StateTone } from '../state/state';
import { MAX_GAZE_SHIFT, gazeOffset } from './gaze';
import { MASCOT_CLOCK } from './mascot-clock';
import { startHops, type Hop } from './mascot-hops';
import { startLife, type GlanceSide, type Life } from './mascot-life';
import { STROKE_FOR, startRally, type Rally, type Stroke } from './mascot-rally';

/** The tone palette per Terminal status (GLOSSARY: Mascot). */
export const statusTone: Record<TerminalStatus, StateTone> = {
  Working: 'success',
  Waiting: 'info',
  Error: 'error',
  Done: 'merged',
  Idle: 'idle',
};

/**
 * Timmy's icon, colored by a Terminal status. The body crossfades between colors; the eyes change with the status. The
 * eyes look at the cursor wherever it is on screen, blink every few seconds, and flick to a side when the cursor has been
 * still for a while. The body moves only by hopping, as often as the status says (mascot-hops.ts), apart from the slow
 * pulse of Waiting and, while Idle, a tennis rally now and then (mascot-rally.ts), whose ball the eyes follow. Every timer
 * runs only while the page can be seen. Under reduced motion the hops, the pulse, the rally and the status animations stop
 * and the color change becomes instant; blinks and eye movement stay, being small.
 */
@Component({
  selector: 'ui-mascot',
  templateUrl: './mascot.html',
  styleUrl: './mascot.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-mascot',
    '[attr.data-status]': 'status()',
    '[style.--tone]': 'tone()',
    '[class.blinking]': 'blinking()',
    '[attr.data-hop]': 'hop()',
    '[attr.data-rally]': 'stroke()',
    '[style.--stroke-for]': 'strokeFor',
    '[style.--gaze-x]': 'eyes().x',
    '[style.--gaze-y]': 'eyes().y',
    '[attr.role]': "label() ? 'img' : null",
    '[attr.aria-label]': 'label() || null',
    '[attr.aria-hidden]': "label() ? null : 'true'",
  },
})
export class MascotComponent {
  readonly status = input<TerminalStatus>('Idle');
  readonly size = input(72, { transform: numberAttribute });
  /** Names the status for assistive technology. Leave empty when the status is already written next to it. */
  readonly label = input('');

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly cursor = inject(CursorState);
  private readonly page = inject(PageVisibility);
  private readonly motion = inject(ReducedMotion);
  private readonly clock = inject(MASCOT_CLOCK);

  protected readonly blinking = signal(false);
  private readonly glance = signal<GlanceSide>(0);
  protected readonly hop = signal<Hop | null>(null);
  protected readonly stroke = signal<Stroke | null>(null);
  /** The length of a stroke, so the animations in mascot.css last exactly as long as the component shows each stroke. */
  protected readonly strokeFor = `${STROKE_FOR}ms`;
  private life: Life | null = null;
  private rally: Rally | null = null;
  /** The status the hops last saw, to tell a status the Mascot turns to from the one it was drawn with. */
  private lastStatus: TerminalStatus | null = null;

  constructor() {
    // The idle life runs only while the page can be seen, and starts over each time it shows again.
    effect((onCleanup) => {
      if (!this.page.visible()) return;
      const life = startLife(this.clock, { blink: (on) => this.blinking.set(on), glance: (side) => this.glance.set(side) });
      this.life = life;
      onCleanup(() => {
        life.stop();
        this.life = null;
      });
    });
    // The hops follow the status. Only a change of status plays the entry hop: not the status it was drawn with, nor the
    // page showing again. A change while hidden or under reduced motion is not replayed later.
    effect((onCleanup) => {
      const status = this.status();
      const entered = this.lastStatus !== null && this.lastStatus !== status;
      this.lastStatus = status;
      if (!this.page.visible() || this.motion.reduced()) return;
      const hops = startHops(this.clock, status, entered, (hop) => this.hop.set(hop));
      onCleanup(() => hops.stop());
    });
    // The rally is Idle's only motion. Any other status, the page hiding or reduced motion ends it at once.
    effect((onCleanup) => {
      if (this.status() !== 'Idle' || !this.page.visible() || this.motion.reduced()) return;
      const rally = startRally(this.clock, (stroke) => this.stroke.set(stroke));
      this.rally = rally;
      onCleanup(() => {
        rally.stop();
        this.rally = null;
      });
    });
    effect(() => {
      this.cursor.point();
      this.life?.cursorMoved();
    });
  }

  /** Plays a rally now, for the showcase. Does nothing where no rally could start on its own: outside Idle, off screen or under reduced motion. */
  playRally(): void {
    this.rally?.play();
  }

  /** The stroke being played, as a list the template can key its court by. */
  protected readonly court = computed(() => {
    const stroke = this.stroke();
    return stroke === null ? [] : [stroke];
  });

  protected readonly tone = computed(() => `var(--support-${statusTone[this.status()]})`);

  /**
   * How far the eyes shift, in units of the 128-unit drawing. Main reports the cursor in the window's own coordinates, the
   * ones the Mascot's box is measured in. The box is measured when a position arrives, and main also sends one while the
   * window moves, so the gaze keeps up with a Mascot that moves under a still cursor.
   */
  protected readonly gaze = computed(() => {
    const cursor = this.cursor.point();
    if (cursor === null) return gazeOffset(null, { x: 0, y: 0 });
    const box = this.host.nativeElement.getBoundingClientRect();
    return gazeOffset(cursor, { x: box.left + box.width / 2, y: box.top + box.height / 2 });
  });

  /** Where the eyes are: on the ball during a rally (the side of the stroke), all the way to a side while they glance, or at the cursor. */
  protected readonly eyes = computed(() => {
    const stroke = this.stroke();
    if (stroke !== null) return { x: (stroke === 'forehand' ? 1 : -1) * MAX_GAZE_SHIFT, y: 0 };
    const side = this.glance();
    const gaze = this.gaze();
    return side === 0 ? gaze : { x: side * MAX_GAZE_SHIFT, y: gaze.y };
  });
}
