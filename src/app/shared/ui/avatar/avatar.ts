import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

export type AvatarTone = 'success' | 'info' | 'warning' | 'error' | 'merged' | 'idle';
export type AvatarSize = 'default' | 'md';

@Component({
  selector: 'ui-avatar',
  template: `@if (text()) {
      <span class="as-avatar__text" aria-hidden="true">{{ text() }}</span>
    }
    <span class="as-avatar__content"><ng-content /></span>`,
  styleUrl: './avatar.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'as-avatar',
    '[class.as-avatar--md]': "size() === 'md'",
    '[style.--tone]': "'var(--support-' + tone() + ')'",
    '[attr.role]': 'name() ? "img" : null',
    '[attr.aria-label]': 'name() || null',
  },
})
export class AvatarComponent {
  readonly name = input('');
  readonly initials = input('');
  readonly tone = input<AvatarTone>('merged');
  readonly size = input<AvatarSize>('default');

  protected readonly text = computed(() => {
    const override = this.initials().trim();
    if (override) return override;
    const words = this.name().trim().split(/\s+/).filter(Boolean).slice(0, 2);
    return words.map((w) => w[0].toUpperCase()).join('');
  });
}
