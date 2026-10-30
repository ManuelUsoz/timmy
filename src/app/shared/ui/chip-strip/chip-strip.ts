import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

export type ChipStripStatus = 'live' | 'done' | 'asks';

export interface ChipStripItem {
  readonly id: string;
  readonly label: string;
  /** Branch glyph before the label. */
  readonly branch?: boolean;
  /**
   * live: green dot (before the label, or after it when `branch`); done: green check after;
   * asks: blue dot before, "ASKS" after, outline and underline.
   */
  readonly status?: ChipStripStatus;
  /** Outline chip (sessions outside the selected one). */
  readonly outline?: boolean;
}

@Component({
  selector: 'ui-chip-strip',
  templateUrl: './chip-strip.html',
  styleUrl: './chip-strip.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { role: 'group', '[attr.aria-label]': 'groupLabel() || label() || null' },
})
export class ChipStripComponent {
  /** Caption shown before the chips (e.g. a project name). */
  readonly label = input('');
  /** Accessible name of the group; falls back to `label`. */
  readonly groupLabel = input('');
  readonly items = input.required<readonly ChipStripItem[]>();
  readonly selectedId = input<string | null>(null);
  readonly selected = output<string>();
}
