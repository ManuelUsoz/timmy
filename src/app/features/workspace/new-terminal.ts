import { ChangeDetectionStrategy, Component, ElementRef, booleanAttribute, effect, inject, input, output, signal, viewChild } from '@angular/core';
import type { Provider } from '../../../shared/settings/settings.model';
import { I18n } from '../../core/i18n';
import { ProviderSettings, providerNames } from '../../core/provider-settings';
import { ButtonComponent, type ButtonKind, type ButtonSize } from '../../shared/ui/button/button';
import { MenuComponent } from '../../shared/ui/menu/menu';
import { OptionComponent } from '../../shared/ui/menu/option';

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
  },
  styles: `
    :host {
      position: relative;
      display: inline-flex;
    }
    .menu {
      position: absolute;
      top: 100%;
      right: 0;
      z-index: 10;
      min-width: 180px;
    }
  `,
  template: `
    <button
      uiButton
      type="button"
      [kind]="kind()"
      [size]="size()"
      [iconOnly]="iconOnly()"
      [disabled]="disabled()"
      [attr.aria-label]="i18n.t('terminals.new')"
      [attr.title]="iconOnly() ? i18n.t('terminals.new') : null"
      [attr.aria-haspopup]="offersProviders() ? 'listbox' : null"
      [attr.aria-expanded]="offersProviders() ? open() : null"
      (click)="press()"
    >
      <ng-content />
    </button>
    @if (open()) {
      <ui-menu #menu class="menu" [ariaLabel]="i18n.t('terminals.new')" (selectionChange)="pick($event)">
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
  readonly disabled = input(false, { transform: booleanAttribute });
  /** The Provider whose CLI to run, or undefined for a plain shell. */
  readonly chosen = output<Provider | undefined>();

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
  }

  protected press(): void {
    if (this.offersProviders()) this.open.update((open) => !open);
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
