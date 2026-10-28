import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, numberAttribute } from '@angular/core';

export type LogoTone = 'success' | 'info' | 'warning' | 'error' | 'merged' | 'idle';

@Component({
  selector: 'ui-logo',
  template: `
    @if (flat()) {
      <svg
        viewBox="0 0 128 128"
        [attr.width]="size()"
        [attr.height]="size()"
        role="img"
        [attr.aria-label]="label()"
      >
        <path
          fill="currentColor"
          d="M64 114C42 114 28 98 28 80C28 62 32 46 44 32C47 40 52 46 57 54C58 36 66 20 72 8C80 28 100 48 100 80C100 98 86 114 64 114Z"
        />
        <rect x="47" y="62" width="8" height="16" rx="4" fill="var(--text-on-color)" />
        <rect x="73" y="62" width="8" height="16" rx="4" fill="var(--text-on-color)" />
      </svg>
    } @else {
      <svg
        viewBox="0 0 128 128"
        [attr.width]="size()"
        [attr.height]="size()"
        role="img"
        [attr.aria-label]="label()"
      >
        <path
          fill="currentColor"
          fill-rule="evenodd"
          d="M96 80A32 32 0 0 1 32 80V64A32 32 0 0 1 48 36L56 54A56 56 0 0 1 72 8A64 64 0 0 1 96 80Z M48 68A4 4 0 0 1 56 68V76A4 4 0 0 1 48 76Z M72 68A4 4 0 0 1 80 68V76A4 4 0 0 1 72 76Z"
        />
      </svg>
    }
  `,
  styleUrl: './logo.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-logo',
    '[class.as-logo--mono]': 'mono()',
    '[style.color]': 'color()',
  },
})
export class LogoComponent {
  readonly size = input(32, { transform: numberAttribute });
  readonly label = input('Timmy');
  readonly tone = input<LogoTone | null>(null);
  readonly mono = input(false, { transform: booleanAttribute });

  protected readonly flat = computed(() => this.size() >= 32);
  protected readonly color = computed(() => {
    if (this.mono()) return 'var(--text-on-color)';
    const tone = this.tone();
    return tone ? `var(--support-${tone})` : 'var(--tone, var(--support-merged))';
  });
}
