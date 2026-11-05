import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Schema } from 'effect';
import { allProviders, Language, type Provider } from '../../../shared/settings/settings.model';
import { I18n } from '../../core/i18n';
import type { MessageKey } from '../../core/i18n-dictionaries';
import { HookSettings } from '../../core/hook-settings';
import { ProviderSettings, providerNames } from '../../core/provider-settings';

type Section = 'providers' | 'hooks' | 'language';

/** Language names are shown in their own language, whatever the interface language is. */
const languageNames: ReadonlyArray<{ readonly value: Language; readonly label: string }> = [
  { value: 'es', label: 'Español' },
  { value: 'en', label: 'English' },
];

/** Settings: the Providers the user uses and the language of the Workspace. */
@Component({
  selector: 'app-settings-screen',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="sections" [attr.aria-label]="i18n.t('settings.title')">
      <h1>{{ i18n.t('settings.title') }}</h1>
      @for (item of sections; track item.id) {
        <button type="button" class="section" [attr.aria-current]="section() === item.id ? 'page' : 'false'" (click)="open(item.id)">
          {{ i18n.t(item.label) }}
        </button>
      }
    </nav>

    <div class="content">
      @if (section() === 'providers') {
        <h2>{{ i18n.t('settings.providers') }}</h2>
        @switch (providerSettings.state().status) {
          @case ('loading') {
            <!-- Nothing to say yet: reading the file takes a moment. -->
          }
          @case ('failed') {
            <p class="failed" role="alert">{{ i18n.t('settings.providers.loadFailed') }}</p>
          }
          @default {
            <div class="rows">
              @for (provider of providers; track provider) {
                @let on = isEnabled(provider);
                <div class="row" data-testid="provider-row">
                  <span class="name">{{ names[provider] }}</span>
                  <span class="status">
                    <span class="dot" [class.on]="on"></span>{{ i18n.t(on ? 'settings.providers.enabled' : 'settings.providers.disabled') }}
                  </span>
                  <button
                    type="button"
                    class="action"
                    [class.off]="!on"
                    [attr.aria-label]="i18n.t(on ? 'settings.providers.disable' : 'settings.providers.enable') + ' ' + names[provider]"
                    (click)="providerSettings.set(provider, !on)"
                  >
                    {{ i18n.t(on ? 'settings.providers.disable' : 'settings.providers.enable') }}
                  </button>
                </div>
              }
            </div>
          }
        }
      } @else if (section() === 'hooks') {
        <h2>{{ i18n.t('settings.hooks') }}</h2>
        <p class="help">{{ i18n.t('settings.hooks.help') }}</p>
        @switch (hookSettings.state().status) {
          @case ('loading') {
            <!-- Nothing to say yet: reading the config takes a moment. -->
          }
          @case ('failed') {
            <p class="failed" role="alert">{{ i18n.t('settings.hooks.loadFailed') }}</p>
          }
          @default {
            @if (hooks().length === 0) {
              <p class="help" data-testid="hooks-empty">{{ i18n.t('settings.hooks.empty') }}</p>
            } @else {
              <div class="rows">
                @for (hook of hooks(); track hook.provider) {
                  <div class="row" data-testid="hook-row">
                    <span class="name">{{ names[hook.provider] }}</span>
                    <span class="status">
                      <span class="dot" [class.on]="hook.active"></span>{{ i18n.t(hook.active ? 'settings.hooks.active' : 'settings.hooks.inactive') }}
                    </span>
                    <button
                      type="button"
                      class="action"
                      [class.off]="!hook.active"
                      [attr.aria-label]="i18n.t(hook.active ? 'settings.hooks.deactivateLabel' : 'settings.hooks.activateLabel', { name: names[hook.provider] })"
                      (click)="hookSettings.setActive(hook.provider, !hook.active)"
                    >
                      {{ i18n.t(hook.active ? 'settings.hooks.deactivate' : 'settings.hooks.activate') }}
                    </button>
                  </div>
                }
              </div>
            }
          }
        }
      } @else {
        <h2>{{ i18n.t('settings.language') }}</h2>
        <div class="rows" role="radiogroup" [attr.aria-label]="i18n.t('settings.language')">
          @for (option of languages; track option.value) {
            <button type="button" role="radio" class="row choice" [class.selected]="i18n.language() === option.value" [attr.aria-checked]="i18n.language() === option.value" (click)="pick(option.value)">
              <span class="name">{{ option.label }}</span>
              @if (i18n.language() === option.value) {
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <polyline points="3 8.5 6.5 12 13 4.5" />
                </svg>
              }
            </button>
          }
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      height: 100%;
      background: var(--sidebar);
      color: var(--text-primary);
      font-family: var(--font-sans);
    }
    button {
      font: inherit;
      color: inherit;
      cursor: pointer;
    }
    button:focus-visible {
      outline: var(--focus-width) solid var(--focus);
      outline-offset: -2px;
    }
    .sections {
      display: flex;
      flex: none;
      flex-direction: column;
      box-sizing: border-box;
      width: 224px;
      padding-block: var(--spacing-06);
      background: var(--sidebar);
    }
    h1 {
      margin: 0 var(--spacing-05) var(--spacing-05);
      font-size: var(--text-heading-02);
      line-height: var(--text-heading-02--line-height);
      letter-spacing: var(--text-heading-02--letter-spacing);
      font-weight: 600;
    }
    .section {
      box-sizing: border-box;
      height: var(--control-md);
      padding: 0 var(--spacing-05);
      border: 0;
      background: transparent;
      color: var(--text-secondary);
      font-size: var(--text-body-compact-01);
      line-height: var(--text-body-compact-01--line-height);
      letter-spacing: var(--text-body-compact-01--letter-spacing);
      text-align: left;
    }
    .section:hover {
      background: var(--layer-hover);
    }
    .section[aria-current='page'] {
      background: var(--layer-selected);
      box-shadow: inset 3px 0 0 var(--button-primary);
      color: var(--text-primary);
    }
    .content {
      display: flex;
      flex: 1 1 0;
      flex-direction: column;
      gap: var(--spacing-06);
      box-sizing: border-box;
      min-width: 0;
      margin: 0;
      padding: var(--spacing-06) var(--spacing-09);
      overflow: auto;
      border: 1px solid var(--border-subtle);
      border-radius: var(--radius-panel);
      background: var(--background);
    }
    h2 {
      margin: 0;
      font-size: var(--text-heading-04);
      line-height: var(--text-heading-04--line-height);
      letter-spacing: var(--text-heading-04--letter-spacing);
      font-weight: 400;
    }
    .rows {
      display: flex;
      flex-direction: column;
      gap: var(--spacing-03);
    }
    .row {
      display: flex;
      align-items: center;
      gap: var(--spacing-05);
      box-sizing: border-box;
      min-height: var(--control-lg);
      padding: 0 var(--spacing-05);
      border: 1px solid var(--border-subtle);
      background: var(--layer-01);
    }
    .name {
      flex: 1 1 0;
      font-size: var(--text-heading-01);
      line-height: var(--text-heading-01--line-height);
      letter-spacing: var(--text-heading-01--letter-spacing);
      font-weight: 600;
      text-align: left;
    }
    .status {
      display: inline-flex;
      align-items: center;
      gap: var(--spacing-03);
      color: var(--text-secondary);
      font-family: var(--font-mono);
      font-size: var(--text-label-01);
      line-height: var(--text-label-01--line-height);
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    .dot {
      width: 8px;
      height: 8px;
      border-radius: var(--radius-full);
      background: var(--support-idle);
    }
    .dot.on {
      background: var(--support-success);
    }
    .action {
      box-sizing: border-box;
      height: var(--control-sm);
      padding: 0 var(--spacing-05);
      border: 0;
      background: transparent;
      color: var(--link);
      font-size: var(--text-body-compact-01);
      line-height: var(--text-body-compact-01--line-height);
      letter-spacing: var(--text-body-compact-01--letter-spacing);
    }
    .action.off {
      border: 1px solid var(--link);
    }
    .action:hover {
      background: var(--layer-hover);
    }
    .choice {
      width: 100%;
    }
    .choice:hover {
      background: var(--layer-hover);
    }
    .choice.selected {
      background: var(--layer-selected);
    }
    .help {
      margin: 0;
      max-width: 640px;
      color: var(--text-secondary);
      font-size: var(--text-body-01);
      line-height: var(--text-body-01--line-height);
      letter-spacing: var(--text-body-01--letter-spacing);
    }
    .failed {
      margin: 0;
      color: var(--text-error);
      font-size: var(--text-body-01);
      line-height: var(--text-body-01--line-height);
      letter-spacing: var(--text-body-01--letter-spacing);
    }
  `,
})
export class SettingsScreen {
  protected readonly i18n = inject(I18n);
  protected readonly providerSettings = inject(ProviderSettings);
  protected readonly hookSettings = inject(HookSettings);

  protected readonly section = signal<Section>('providers');
  protected readonly sections: ReadonlyArray<{ readonly id: Section; readonly label: MessageKey }> = [
    { id: 'providers', label: 'settings.providers' },
    { id: 'hooks', label: 'settings.hooks' },
    { id: 'language', label: 'settings.language' },
  ];

  protected readonly providers = allProviders;
  protected readonly names = providerNames;
  protected readonly languages = languageNames;

  /** The Hooks of the Providers; empty while loading or when reading failed. */
  protected readonly hooks = computed(() => {
    const state = this.hookSettings.state();
    return state.status === 'ready' ? state.hooks : [];
  });

  /** Opening Hooks reads them again: a Provider may have been enabled in Providers since. */
  protected open(id: Section): void {
    this.section.set(id);
    if (id === 'hooks') this.hookSettings.refresh();
  }

  protected isEnabled(provider: Provider): boolean {
    return this.providerSettings.enabled().includes(provider);
  }

  protected pick(value: unknown): void {
    if (Schema.is(Language)(value)) this.i18n.setLanguage(value);
  }
}
