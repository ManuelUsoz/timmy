import { Component, inject, signal } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import type { AppInfo } from '../shared/app-info/app-info.rpc';
import { DesktopApi } from './core/desktop-api';
import { EffectRuntime } from './core/effect-runtime';

@Component({
  selector: 'app-root',
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App {
  private readonly runtime = inject(EffectRuntime);

  protected readonly info = signal<AppInfo | null>(null);
  protected readonly error = signal<string | null>(null);

  constructor() {
    const program = Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      return yield* desktop['AppInfo.get']();
    });

    void this.runtime.run(program).then(
      Exit.match({
        onFailure: (cause) => this.error.set(Cause.pretty(cause)),
        onSuccess: (appInfo) => this.info.set(appInfo),
      }),
    );
  }
}
