import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { Effect, Stream, pipe } from 'effect';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { TerminalId, type TerminalActivityEntry } from '../../../shared/terminal/terminal.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { addTerminal, restarted, withActivity, withExit, withOutput, withState, type TerminalEntry, type TerminalState } from './terminal-entries';

@Injectable({ providedIn: 'root' })
export class TerminalsState {
  private readonly all = signal<ReadonlyArray<TerminalEntry>>([]);
  readonly entries = this.all.asReadonly();
  /** The last activity main reported, kept for a Terminal whose entry is added after main already spoke of it. */
  private reported: ReadonlyArray<TerminalActivityEntry> = [];
  private readonly currentId = signal<TerminalId | undefined>(undefined);
  /** The Terminal the user is on, in the Workspace or the Panel: the one picked last, else the newest. Undefined when there are none. */
  readonly current = computed((): TerminalEntry | undefined => this.all().find((entry) => entry.id === this.currentId()) ?? this.all().at(-1));

  constructor(private readonly runtime: EffectRuntime) {
    // What main reads from each Terminal's output lives as long as the app: the Pill needs it with no Terminal on screen.
    const stop = new AbortController();
    inject(DestroyRef).onDestroy(() => stop.abort());
    void this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) =>
        Stream.runForEach(desktop['Terminal.activity'](), (snapshot) => Effect.sync(() => this.applyActivity(snapshot))),
      ),
      { signal: stop.signal },
    );
  }

  /** Opens a shell in the folder; with a Provider, that Provider's CLI runs in it. */
  async createLive(projectId: ProjectId, cwd: string, provider?: Provider): Promise<TerminalEntry | undefined> {
    const result = await this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        return yield* desktop['Terminal.create'](provider === undefined ? { cwd } : { cwd, provider });
      }),
    );
    if (result._tag === 'Failure') return undefined;
    const entry = addTerminal(this.all(), projectId, result.value.terminalId, provider).at(-1)!;
    this.all.update((entries) => pipe(withState([...entries, entry], entry.id, 'Live'), (next) => withActivity(next, this.reported)));
    this.currentId.set(entry.id);
    return { ...entry, state: 'Live' };
  }

  create(projectId: ProjectId): TerminalEntry {
    const id = TerminalId.make(crypto.randomUUID());
    const entry = addTerminal(this.all(), projectId, id).at(-1)!;
    this.all.update((entries) => [...entries, entry]);
    return entry;
  }

  find(id: string): TerminalEntry | undefined {
    return this.all().find((entry) => entry.id === id);
  }

  /** Makes a Terminal the current one; an id that is not (or no longer) a Terminal leaves the current one as it is. */
  setCurrent(id: TerminalId): void {
    if (this.find(id) !== undefined) this.currentId.set(id);
  }

  appendOutput(id: TerminalId, data: string): void {
    this.all.update((entries) => withOutput(entries, id, data));
  }

  setState(id: TerminalId, state: TerminalState): void {
    this.all.update((entries) => withState(entries, id, state));
  }

  private applyActivity(snapshot: ReadonlyArray<TerminalActivityEntry>): void {
    this.reported = snapshot;
    this.all.update((entries) => withActivity(entries, snapshot));
  }

  /** The user is on this Terminal: tells main, which clears what asked for their attention. */
  async focus(id: TerminalId): Promise<void> {
    await this.runtime.run(Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* desktop['Terminal.focus']({ terminalId: id });
    }));
  }

  exited(id: TerminalId, exitCode: number): void {
    this.all.update((entries) => withExit(entries, id, exitCode));
  }

  /** Kills the process of a terminal and starts a new one in the same folder under the same name, running the same Provider. */
  async restart(id: TerminalId, cwd: string): Promise<TerminalEntry | undefined> {
    const provider = this.find(id)?.provider;
    const result = await this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        yield* desktop['Terminal.close']({ terminalId: id }).pipe(Effect.ignore);
        return yield* desktop['Terminal.create'](provider === undefined ? { cwd } : { cwd, provider });
      }),
    );
    if (result._tag === 'Failure') return undefined;
    this.all.update((entries) => pipe(restarted(entries, id, result.value.terminalId), (next) => withActivity(next, this.reported)));
    if (this.currentId() === id) this.currentId.set(result.value.terminalId);
    return this.find(result.value.terminalId);
  }

  async write(id: TerminalId, data: string): Promise<void> {
    await this.runtime.run(Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* desktop['Terminal.write']({ terminalId: id, data });
    }));
  }

  async resize(id: TerminalId, cols: number, rows: number): Promise<void> {
    await this.runtime.run(Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* desktop['Terminal.resize']({ terminalId: id, cols, rows });
    }));
  }

  async close(id: TerminalId): Promise<void> {
    await this.runtime.run(Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* desktop['Terminal.close']({ terminalId: id });
    }));
    this.all.update((entries) => entries.filter((entry) => entry.id !== id));
  }
}
