import { ChangeDetectionStrategy, Component, ElementRef, booleanAttribute, computed, effect, inject, input, output, signal, untracked, viewChild } from '@angular/core';
import type { Provider } from '../../../shared/settings/settings.model';
import { I18n } from '../../core/i18n';
import { ProviderSettings, providerNames } from '../../core/provider-settings';
import { ButtonComponent, type ButtonKind, type ButtonSize } from '../../shared/ui/button/button';
import { MenuComponent } from '../../shared/ui/menu/menu';
import { OptionComponent } from '../../shared/ui/menu/option';
import { TabsState } from './tabs-state';

/** The plain shell is the first entry of the picker and what a Terminal is when no Provider is chosen. */
const SHELL = 'shell';

/**
 * "New terminal". With no Provider enabled in Settings it opens a plain shell at once. Otherwise it offers the
 * plain shell, then each enabled Provider. The button's own content (icon, text) is projected.
 */
@Component({
  selector: 'app-new-terminal',
  imports: [ButtonComponent, MenuComponent, OptionComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:click)': 'closeOnOutside($event)',
    '(document:keydown.escape)': 'open.set(false)',
    '[class.align-end]': 'iconOnly()',
    '[class.up]': 'up()',
  },
  styles: `
    :host {
      position: relative;
      display: inline-flex;
    }
    .menu {
      position: absolute;
      top: 100%;
      left: 0;
      z-index: 10;
      min-width: 180px;
    }
    /* Opens upwards, for a button at the bottom edge of a column. */
    :host(.up) .menu {
      top: auto;
      bottom: 100%;
    }
    /* The icon-only "+" sits at the right edge of its column: open the menu towards the left so it is not clipped. */
    :host(.align-end) .menu {
      left: auto;
      right: 0;
    }
  `,
  template: `
    <button
      uiButton
      type="button"
      [kind]="kind()"
      [size]="size()"
      [iconOnly]="iconOnly()"
      [neutral]="neutral()"
      [disabled]="disabled()"
      [attr.aria-label]="name()"
      [attr.title]="iconOnly() ? (hint() ?? name()) : null"
      [attr.aria-haspopup]="offersProviders() ? 'listbox' : null"
      [attr.aria-expanded]="offersProviders() ? open() : null"
      (click)="press()"
    >
      <ng-content />
    </button>
    @if (open()) {
      <ui-menu #menu class="menu" [ariaLabel]="name()" (selectionChange)="pick($event)">
        <ui-option [value]="shell">{{ i18n.t('terminals.shell') }}</ui-option>
        @for (provider of providers.enabled(); track provider) {
          <ui-option [value]="provider">{{ names[provider] }}</ui-option>
        }
      </ui-menu>
    }
  `,
})
export class NewTerminal {
  protected readonly i18n = inject(I18n);
  protected readonly providers = inject(ProviderSettings);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  readonly kind = input<ButtonKind>('primary');
  readonly size = input<ButtonSize>('md');
  readonly iconOnly = input(false, { transform: booleanAttribute });
  readonly neutral = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  /** Opens the menu above the button instead of below it. */
  readonly up = input(false, { transform: booleanAttribute });
  /** The button's and the picker's accessible name; "New terminal" unless the caller names it. */
  readonly label = input<string>();
  /** The tooltip of the icon-only button, when it should say more than the name (a key hint). */
  readonly hint = input<string>();
  /** Ctrl+T opens this picker. Only the New Tab button on screen answers it. */
  readonly answersNewTab = input(false, { transform: booleanAttribute });
  /** The Provider whose CLI to run, or undefined for a plain shell. */
  readonly chosen = output<Provider | undefined>();

  protected readonly name = computed(() => this.label() ?? this.i18n.t('terminals.new'));
  private readonly tabs = inject(TabsState);

  protected readonly shell = SHELL;
  protected readonly names = providerNames;
  protected readonly open = signal(false);
  protected offersProviders(): boolean {
    return this.providers.enabled().length > 0;
  }

  private readonly menu = viewChild('menu', { read: ElementRef<HTMLElement> });

  constructor() {
    // Keyboard users land on the menu, whose arrows and Enter pick an entry.
    effect(() => this.menu()?.nativeElement.focus());
    // Only the requests made while this button is on screen count: the ones before it appeared were answered or lost.
    // Each request is handled once, so `answersNewTab` turning on later does not replay an old one.
    let handled = this.tabs.newTabRequests();
    effect(() => {
      const requests = this.tabs.newTabRequests();
      if (requests === handled) return;
      handled = requests;
      if (this.answersNewTab()) untracked(() => this.start());
    });
  }

  /** A click toggles the picker. */
  protected press(): void {
    if (this.offersProviders()) this.open.update((open) => !open);
    else this.chosen.emit(undefined);
  }

  /** Ctrl+T opens the picker, and leaves it open when it already is. */
  private start(): void {
    if (this.offersProviders()) this.open.set(true);
    else this.chosen.emit(undefined);
  }

  protected pick(value: unknown): void {
    this.open.set(false);
    this.chosen.emit(value === SHELL ? undefined : (value as Provider));
  }

  protected closeOnOutside(event: Event): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }
}
