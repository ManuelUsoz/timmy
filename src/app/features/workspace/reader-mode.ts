import { Injectable, inject, signal } from '@angular/core';
import { Effect, Exit } from 'effect';
import type { ReaderMode as Mode } from '../../../shared/settings/settings.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';

/**
 * The reader's one Renderizado/Fuente choice (Imagen/Fuente for an SVG), kept in main with the other settings: the same for
 * every file, every File View and the Quick look, never per file or per Tab and not in the saved layout. The last choice
 * wins. Read from main the first time a file that has a drawn form needs it; Fuente until then.
 */
@Injectable({ providedIn: 'root' })
export class ReaderMode {
  private readonly runtime = inject(EffectRuntime);

  private readonly current = signal<Mode>('source');
  readonly mode = this.current.asReadonly();
  private loaded = false;

  /** Reads the stored choice once; a choice made meanwhile is newer and stays. */
  load(): void {
    if (this.loaded) return;
    this.loaded = true;
    void this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Settings.get']())).then((exit) => {
      if (Exit.isSuccess(exit) && !this.changed) this.current.set(exit.value.reader);
    });
  }

  private changed = false;

  /** Shows every such file this way from now on, and stores it so it survives a restart. */
  set(mode: Mode): void {
    this.changed = true;
    this.loaded = true;
    this.current.set(mode);
    void this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Settings.setReader']({ reader: mode })));
  }
}
