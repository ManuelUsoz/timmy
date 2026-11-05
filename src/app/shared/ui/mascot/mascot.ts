import { ChangeDetectionStrategy, Component, computed, input, numberAttribute } from '@angular/core';
import type { TerminalStatus } from '../../../../shared/notification/notification.model';
import type { StateTone } from '../state/state';

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
 * the status. Motion stops under reduced motion and the color change becomes instant.
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

  protected readonly tone = computed(() => `var(--support-${statusTone[this.status()]})`);
}
