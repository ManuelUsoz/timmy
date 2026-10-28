import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

export type PillTone = 'neutral' | 'running' | 'waiting' | 'error' | 'done';

@Component({
  selector: 'ui-pill',
  templateUrl: './pill.html',
  styleUrl: './pill.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-pill',
    'data-theme': 'g100',
    '[class.as-pill--neutral]': "tone() === 'neutral'",
    '[class.as-pill--running]': "tone() === 'running'",
    '[class.as-pill--waiting]': "tone() === 'waiting'",
    '[class.as-pill--attn]': "tone() === 'waiting'",
    '[class.as-pill--error]': "tone() === 'error'",
    '[class.as-pill--done]': "tone() === 'done'",
    '[class.as-pill--pulse]': 'pulse()',
  },
})
export class PillComponent {
  readonly tone = input<PillTone>('neutral');
  readonly label = input('');
  readonly pulse = input(false, { transform: booleanAttribute });
}
