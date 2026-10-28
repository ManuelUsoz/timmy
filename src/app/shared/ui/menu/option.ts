import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  Signal,
  booleanAttribute,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

export type OptionSize = 'default' | 'sm';

/** Implemented by the parent menu; lives here so option.ts does not import menu.ts. */
export interface OptionHost {
  readonly multiple: Signal<boolean>;
  pick(option: OptionComponent): void;
}

export const OPTION_HOST = new InjectionToken<OptionHost>('OPTION_HOST');

let nextId = 0;

@Component({
  selector: 'ui-option',
  template: `
    @if (multiple()) {
      <span class="mark" aria-hidden="true">
        @if (selected()) {
          <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 8.5l3.2 3L13 4.5" />
          </svg>
        }
      </span>
    }
    <span class="label"><ng-content /></span>
    @if (meta()) {
      <span class="meta">{{ meta() }}</span>
    }
    @if (!multiple() && selected()) {
      <svg class="check" viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor"
        stroke-width="1.5" aria-hidden="true">
        <path d="M3 8.5l3.2 3L13 4.5" />
      </svg>
    }
  `,
  styleUrl: './option.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    role: 'option',
    '[id]': 'id',
    '[attr.aria-selected]': 'selected()',
    '[attr.aria-disabled]': 'disabled() || null',
    '[attr.data-active]': 'active() ? "" : null',
    '[attr.data-size]': 'size()',
    '[class.multi]': 'multiple()',
    '(click)': 'choose()',
  },
})
export class OptionComponent {
  readonly value = input<unknown>();
  readonly selected = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly meta = input<string>();
  readonly size = input<OptionSize>('default');
  readonly picked = output<unknown>();

  readonly id = `ui-option-${nextId++}`;
  readonly active = signal(false);

  private readonly host = inject(OPTION_HOST, { optional: true });
  protected readonly multiple = computed(() => this.host?.multiple() ?? false);

  protected choose(): void {
    if (this.disabled()) return;
    this.picked.emit(this.value());
    this.host?.pick(this);
  }

  /** Called by the menu for keyboard selection. */
  activate(): void {
    this.choose();
  }
}
