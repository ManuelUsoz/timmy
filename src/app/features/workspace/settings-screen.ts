import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Schema } from 'effect';
import { Language } from '../../../shared/settings/settings.model';
import { I18n } from '../../core/i18n';
import { SwitcherComponent } from '../../shared/ui/switcher/switcher';
import type { SwitcherOption } from '../../shared/ui/switcher/switcher.types';

/** Settings. For now only the language, which applies to the whole Workspace at once. */
@Component({
  selector: 'app-settings-screen',
  imports: [FormsModule, SwitcherComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="settings">
      <h1>{{ i18n.t('settings.title') }}</h1>
      <div class="field" role="group" aria-labelledby="language-label">
        <div class="text">
          <span id="language-label" class="label">{{ i18n.t('settings.language') }}</span>
          <span class="help">{{ i18n.t('settings.languageHelp') }}</span>
        </div>
        <ui-switcher [options]="options" [ngModel]="i18n.language()" (ngModelChange)="pick($event)" />
      </div>
      @if (i18n.error()) {
        <p class="error" role="alert">{{ i18n.t('settings.saveFailed') }}</p>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
      height: 100%;
      overflow: auto;
    }
    .settings {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-06);
      max-width: 640px;
      padding: var(--spacing-07);
    }
    h1 {
      margin: 0;
      font: var(--text-heading-03);
    }
    .field {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--spacing-05);
      padding: var(--spacing-05);
      background: var(--layer-01);
    }
    .text {
      display: flex;
      flex-direction: column;
    }
    .label {
      font: var(--text-heading-01);
    }
    .help {
      color: var(--text-helper);
      font: var(--text-helper-text-01);
    }
    .error {
      margin: 0;
      color: var(--text-error);
    }
  `,
})
export class SettingsScreen {
  protected readonly i18n = inject(I18n);

  /** Language names are shown in their own language, whatever the interface language is. */
  protected readonly options: SwitcherOption<Language>[] = [
    { value: 'es', label: 'Español' },
    { value: 'en', label: 'English' },
  ];

  protected pick(value: unknown): void {
    if (Schema.is(Language)(value)) this.i18n.setLanguage(value);
  }
}
