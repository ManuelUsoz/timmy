import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  afterNextRender,
  booleanAttribute,
  inject,
  input,
  isDevMode,
} from '@angular/core';

export type ButtonKind = 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

@Component({
  selector: 'button[uiButton], a[uiButton]',
  template: '<ng-content />',
  styleUrl: './button.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-btn',
    '[class.as-btn--primary]': "kind() === 'primary'",
    '[class.as-btn--secondary]': "kind() === 'secondary'",
    '[class.as-btn--tertiary]': "kind() === 'tertiary'",
    '[class.as-btn--ghost]': "kind() === 'ghost'",
    '[class.as-btn--danger]': "kind() === 'danger'",
    '[class.as-btn--sm]': "size() === 'sm'",
    '[class.as-btn--lg]': "size() === 'lg'",
    '[class.as-btn--icon]': 'iconOnly()',
    '[class.as-btn--block]': 'block()',
    '[class.as-btn--neutral]': 'neutral()',
  },
})
export class ButtonComponent {
  readonly kind = input<ButtonKind>('primary');
  readonly size = input<ButtonSize>('md');
  readonly iconOnly = input(false, { transform: booleanAttribute });
  readonly block = input(false, { transform: booleanAttribute });
  readonly neutral = input(false, { transform: booleanAttribute });

  constructor() {
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    afterNextRender(() => {
      if (isDevMode() && this.iconOnly() && !el.hasAttribute('aria-label')) {
        console.warn('uiButton: iconOnly requires an aria-label', el);
      }
    });
  }
}
