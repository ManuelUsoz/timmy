import { ChangeDetectionStrategy, Component, booleanAttribute, input } from '@angular/core';

export type PillTone = 'neutral' | 'running' | 'waiting' | 'error' | 'done';

let nextId = 0;

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
    '[class.as-pill--square]': 'square()',
  },
})
export class PillComponent {
  /** Colours the state dot; 'waiting' also draws the inset info line. */
  readonly tone = input<PillTone>('neutral');
  /** State word (Idle, Live, 4 live, Asks, Done). Part of the accessible name. */
  readonly label = input('');
  readonly pulse = input(false, { transform: booleanAttribute });
  /** Square corners (radius 0), as in the collapsed corner pill. */
  readonly square = input(false, { transform: booleanAttribute });
  /** Subagent count; hidden when null or undefined. */
  readonly subagents = input<number | null>(null);
  /** Worktree count; hidden when null or undefined. */
  readonly worktrees = input<number | null>(null);

  private readonly uid = `ui-pill-${nextId++}`;
  protected readonly stateId = `${this.uid}-state`;
  protected readonly textId = `${this.uid}-text`;
  protected readonly countsId = `${this.uid}-counts`;
  protected readonly metaId = `${this.uid}-meta`;
  protected readonly actionId = `${this.uid}-action`;
  protected readonly labelledBy = [this.stateId, this.textId, this.countsId, this.metaId, this.actionId].join(' ');
}
