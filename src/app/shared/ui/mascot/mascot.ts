import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, numberAttribute } from '@angular/core';
import type { TerminalStatus } from '../../../../shared/notification/notification.model';
import { CursorState } from '../../../core/cursor-state';
import type { StateTone } from '../state/state';
import { gazeOffset } from './gaze';

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
 * the status. The eyes look at the cursor wherever it is on screen. Motion stops under reduced motion, the color change
 * becomes instant and the eyes look straight ahead.
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
    '[style.--gaze-x]': 'gaze().x',
    '[style.--gaze-y]': 'gaze().y',
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
}
