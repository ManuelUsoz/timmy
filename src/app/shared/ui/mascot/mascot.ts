import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import type { TerminalStatus } from '../../../../shared/notification/notification.model';
import { CursorState } from '../../../core/cursor-state';
import { PageVisibility } from '../../../core/page-visibility';
import type { StateTone } from '../state/state';
import { MAX_GAZE_SHIFT, gazeOffset } from './gaze';
import { MASCOT_CLOCK } from './mascot-clock';
import { startLife, type GlanceSide, type Life } from './mascot-life';

/** The tone palette per Terminal status (GLOSSARY: Mascot). */
export const statusTone: Record<TerminalStatus, StateTone> = {
  Working: 'success',
  Waiting: 'info',
  Error: 'error',
  Done: 'merged',
  Idle: 'idle',
};

/**
 * Timmy's icon, colored by a Terminal status. The body crossfades between colors; the eyes and the movement change with
 * the status. The eyes look at the cursor wherever it is on screen, blink every few seconds, and flick to a side when the
 * cursor has been still for a while. Those timers run only while the page can be seen. Under reduced motion the body and
 * the status animations stop and the color change becomes instant; blinks and eye movement stay, being small.
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
  private readonly clock = inject(MASCOT_CLOCK);

  protected readonly blinking = signal(false);
  private readonly glance = signal<GlanceSide>(0);
  private life: Life | null = null;

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
    effect(() => {
      this.cursor.point();
      this.life?.cursorMoved();
    });
  }

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

  /** Where the eyes are: at the cursor, or all the way to a side while they glance. */
  protected readonly eyes = computed(() => {
    const side = this.glance();
    const gaze = this.gaze();
    return side === 0 ? gaze : { x: side * MAX_GAZE_SHIFT, y: gaze.y };
  });
}
