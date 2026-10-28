import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  computed,
  contentChildren,
  effect,
  forwardRef,
  untracked,
  input,
  output,
  signal,
} from '@angular/core';
import { OPTION_HOST, OptionComponent, OptionHost } from './option';

let nextId = 0;

@Component({
  selector: 'ui-menu',
  templateUrl: './menu.html',
  styleUrl: './menu.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [{ provide: OPTION_HOST, useExisting: forwardRef(() => MenuComponent) }],
  host: {
    role: 'listbox',
    tabindex: '0',
    '[attr.aria-multiselectable]': 'multiple()',
    '[attr.aria-label]': 'ariaLabel() || null',
    '[attr.aria-activedescendant]': 'activeId()',
    '[class.float]': 'float()',
    '(keydown)': 'onKeydown($event)',
  },
})
export class MenuComponent implements OptionHost {
  readonly float = input(false, { transform: booleanAttribute });
  readonly multiple = input(false, { transform: booleanAttribute });
  readonly loading = input(false, { transform: booleanAttribute });
  readonly loadingLabel = input('Loading…');
  readonly emptyLabel = input('No results');
  readonly createLabel = input<string>();
  readonly ariaLabel = input<string>();

  readonly selectionChange = output<unknown>();
  readonly create = output<void>();

  protected readonly createId = `ui-menu-create-${nextId++}`;
  protected readonly options = contentChildren(OptionComponent, { descendants: true });
  protected readonly activeIndex = signal(-1);
  /** The create row sits after the last option in the keyboard index space. */
  protected readonly createActive = computed(
    () => !!this.createLabel() && this.activeIndex() === this.options().length,
  );
  protected readonly activeId = computed(() =>
    this.createActive() ? this.createId : (this.options()[this.activeIndex()]?.id ?? null),
  );
  protected readonly isEmpty = computed(() => this.options().length === 0);

  constructor() {
    // Options or the create row changed: drop a stale active index.
    effect(() => {
      const opts = this.options();
      const last = opts.length - 1 + (this.createLabel() ? 1 : 0);
      untracked(() => {
        if (this.activeIndex() > last) this.setActive(-1);
        else opts.forEach((o, i) => o.active.set(i === this.activeIndex()));
      });
    });
  }

  pick(option: OptionComponent): void {
    this.setActive(this.options().indexOf(option));
    this.selectionChange.emit(option.value());
  }

  protected onKeydown(event: KeyboardEvent): void {
    const opts = this.options();
    const enabled = opts.map((o, i) => (o.disabled() ? -1 : i)).filter((i) => i >= 0);
    if (this.createLabel()) enabled.push(opts.length);
    if (!enabled.length) return;
    const pos = enabled.indexOf(this.activeIndex());
    let next: number | undefined;
    switch (event.key) {
      case 'ArrowDown':
        next = enabled[pos < 0 ? 0 : Math.min(pos + 1, enabled.length - 1)];
        break;
      case 'ArrowUp':
        next = enabled[pos < 0 ? enabled.length - 1 : Math.max(pos - 1, 0)];
        break;
      case 'Home':
        next = enabled[0];
        break;
      case 'End':
        next = enabled[enabled.length - 1];
        break;
      case 'Enter':
      case ' ':
        event.preventDefault();
        if (this.createActive()) this.create.emit();
        else opts[this.activeIndex()]?.activate();
        return;
      default:
        return;
    }
    event.preventDefault();
    this.setActive(next);
  }

  private setActive(index: number): void {
    this.options().forEach((o, i) => o.active.set(i === index));
    this.activeIndex.set(index);
  }
}
