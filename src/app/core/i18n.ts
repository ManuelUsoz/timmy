import { Injectable, computed, inject, signal } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import { defaultLanguage, type Language } from '../../shared/settings/settings.model';
import { DesktopApi } from './desktop-api';
import { EffectRuntime } from './effect-runtime';
import { dictionaries, type MessageKey } from './i18n-dictionaries';
import { ToastService } from './toast';

/**
 * The language of the Workspace. A new language is applied instantly and then stored in main; if main
 * cannot store it, the previous language comes back and `error` says why.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly runtime = inject(EffectRuntime);
  private readonly toasts = inject(ToastService);

  readonly language = signal<Language>(defaultLanguage);
  readonly error = signal<string | null>(null);

  /** Set once the user picks a language, so a slow first load from main cannot overwrite the choice. */
  private chosen = false;

  private readonly dictionary = computed(() => dictionaries[this.language()]);

  constructor() {
    void this.runtime
      .run(Effect.flatMap(DesktopApi, (desktop) => desktop['Settings.get']()))
      .then((exit) => {
        if (Exit.isSuccess(exit)) {
          if (!this.chosen) this.apply(exit.value.language);
        }
        else this.error.set(Cause.pretty(exit.cause));
      });
  }

  private apply(language: Language): void {
    this.language.set(language);
    document.documentElement.lang = language;
  }

  /** The text of `key`; each `{name}` in it is replaced by the value of `params.name`. */
  t(key: MessageKey, params?: Readonly<Record<string, string | number>>): string {
    const text = this.dictionary()[key];
    if (params === undefined) return text;
    return text.replace(/\{(\w+)\}/g, (match, name: string) => String(params[name] ?? match));
  }

  setLanguage(language: Language): void {
    const previous = this.language();
    if (language === previous) return;
    this.chosen = true;
    this.apply(language);
    this.error.set(null);
    void this.runtime
      .run(Effect.flatMap(DesktopApi, (desktop) => desktop['Settings.setLanguage']({ language })))
      .then((exit) => {
        if (Exit.isSuccess(exit)) return;
        // Only undo our own change: the user may have picked another language meanwhile.
        if (this.language() === language) this.apply(previous);
        const detail = Cause.pretty(exit.cause);
        this.error.set(detail);
        this.toasts.error('settings.saveFailed', { detail });
      });
  }
}
