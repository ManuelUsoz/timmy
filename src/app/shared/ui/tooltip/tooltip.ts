import { ChangeDetectionStrategy, Component, input, signal } from '@angular/core';

export type TooltipPlacement = 'top' | 'bottom' | 'left' | 'right';

let nextId = 0;

/**
 * Wraps its content and shows `text` in a Carbon-style inverse popup above it on hover or keyboard
 * focus. Escape dismisses it. The popup describes the wrapped content for assistive tech.
 */
@Component({
  selector: 'ui-tooltip',
  template: `
    <span class="as-tooltip__trigger" [attr.aria-describedby]="visible() ? id : null">
      <ng-content />
    </span>
    @if (visible()) {
      <span class="as-tooltip__popup" role="tooltip" [id]="id">{{ text() }}</span>
    }
  `,
  styleUrl: './tooltip.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-tooltip',
    '[attr.data-placement]': 'placement()',
    '(mouseenter)': 'show()',
    '(mouseleave)': 'hide()',
    '(focusin)': 'show()',
    '(focusout)': 'hide()',
    '(keydown.escape)': 'hide()',
  },
})
export class TooltipComponent {
  readonly text = input.required<string>();
  /** Which side of the content the popup opens on. */
  readonly placement = input<TooltipPlacement>('top');

  protected readonly id = `ui-tooltip-${nextId++}`;
  protected readonly visible = signal(false);

  protected show(): void {
    if (this.text()) this.visible.set(true);
  }

  protected hide(): void {
    this.visible.set(false);
  }
}
