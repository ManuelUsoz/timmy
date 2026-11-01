import { Injectable, computed, inject, signal } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import { defaultLanguage, type Language } from '../../shared/settings/settings.model';
import { DesktopApi } from './desktop-api';
import { EffectRuntime } from './effect-runtime';
import { dictionaries, type MessageKey } from './i18n-dictionaries';

/**
 * The language of the Workspace. A new language is applied instantly and then stored in main; if main
 * cannot store it, the previous language comes back and `error` says why.
 */
@Injectable({ providedIn: 'root' })
export class I18n {
  private readonly runtime = inject(EffectRuntime);

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

  t(key: MessageKey): string {
    return this.dictionary()[key];
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
        this.error.set(Cause.pretty(exit.cause));
      });
  }
}
