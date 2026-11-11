import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Effect, Exit, Stream } from 'effect';
import type { FileVersion } from '../../../shared/files/files.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { CHANGES_DEBOUNCE_MS } from './files-browser';

/** What the disk says of a file: its version, or null when it is not a file now. */
export type DiskVersion = FileVersion | null;

/** Whether two versions are the same file on disk. */
export const sameVersion = (a: DiskVersion, b: DiskVersion): boolean => (a === null || b === null ? a === b : a.modified === b.modified && a.size === b.size);

const keyOf = (cwd: string, path: string) => `${cwd}\0${path}`;

/**
 * The latest version of every file an open File View shows (GLOSSARY: Stale File View). A View `watch`es its file while it
 * is open, and asks for the version it loaded from with `baseline`. `check` asks main for the version of every watched
 * file at once (one `Files.versions` per Project, no content), on the triggers of the Changed markers: a Hook that says an
 * agent used a tool or stopped, and the window taking the focus; plus a View becoming visible or focused, which calls it.
 * Triggers that come close together are one check. No timer and no watcher: an idle Project costs nothing.
 *
 * A Quick look never watches: it has no hint.
 */
@Injectable({ providedIn: 'root' })
export class FileVersions {
  private readonly runtime = inject(EffectRuntime);
  private readonly debounce = inject(CHANGES_DEBOUNCE_MS);
  /** The open File Views, by file: how many Views show each. */
  private readonly watched = new Map<string, { readonly cwd: string; readonly path: string; views: number }>();
  /** What the last answer said per file; none for a file never answered. A failed check keeps it. */
  private readonly known = signal<ReadonlyMap<string, DiskVersion>>(new Map());
  private timer: ReturnType<typeof setTimeout> | undefined;
  private running = false;
  private again = false;

  constructor() {
    const stop = new AbortController();
    const onFocus = () => this.check();
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => {
      stop.abort();
      window.removeEventListener('focus', onFocus);
      clearTimeout(this.timer);
    });
    void this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) =>
        Stream.runForEach(desktop['Terminal.hookReports'](), (report) => Effect.sync(() => (report.signal === 'Working' || report.signal === 'Done' ? this.check() : undefined))),
      ),
      { signal: stop.signal },
    );
  }

  /** The latest version main answered for the file: none yet (undefined), gone (null) or its version. Read it in a computed. */
  latest(cwd: string, path: string): DiskVersion | undefined {
    return this.known().get(keyOf(cwd, path));
  }

  /** Includes the file in every check until the returned function is called. */
  watch(cwd: string, path: string): () => void {
    const key = keyOf(cwd, path);
    const entry = this.watched.get(key) ?? { cwd, path, views: 0 };
    entry.views += 1;
    this.watched.set(key, entry);
    return () => {
      entry.views -= 1;
      if (entry.views === 0) this.watched.delete(key);
    };
  }

  /**
   * The version of the file right now, asked on its own and recorded as the latest: what a View loads from. Asked before
   * the content is read, so a change that lands meanwhile still shows as stale. None when main could not answer.
   */
  async baseline(cwd: string, path: string): Promise<DiskVersion | undefined> {
    const answered = await this.ask(cwd, [path]);
    return answered.get(path);
  }

  /** Asks for the versions again; triggers that come close together become one check, run when they stop. */
  check(): void {
    if (this.watched.size === 0) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.run();
    }, this.debounce);
  }

  /** One check at a time; one asked for while it runs makes it run once more after. */
  private async run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return;
    }
    this.running = true;
    const byProject = new Map<string, string[]>();
    for (const { cwd, path } of this.watched.values()) byProject.set(cwd, [...(byProject.get(cwd) ?? []), path]);
    await Promise.all([...byProject].map(([cwd, paths]) => this.ask(cwd, paths)));
    this.running = false;
    if (this.again) {
      this.again = false;
      this.check();
    }
  }

  /** Asks main and records the answers; a failure is silent, a hint is not worth an error. */
  private async ask(cwd: string, files: ReadonlyArray<string>): Promise<ReadonlyMap<string, DiskVersion>> {
    const exit = await this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Files.versions']({ cwd, files })));
    const answers = new Map<string, DiskVersion>(Exit.isSuccess(exit) ? exit.value.map(({ file, version }) => [file, version]) : []);
    if (answers.size > 0) {
      this.known.update((known) => new Map([...known, ...[...answers].map(([file, version]) => [keyOf(cwd, file), version] as const)]));
    }
    return answers;
  }
}
