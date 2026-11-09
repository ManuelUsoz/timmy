import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { Effect, Exit, Stream, pipe } from 'effect';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { TerminalId, type TerminalActivityEntry } from '../../../shared/terminal/terminal.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { TabId } from './tabs';
import { addTerminal, restarted, withActivity, withExit, withScreen, withState, type TerminalEntry, type TerminalScreenSnapshot, type TerminalState } from './terminal-entries';
import { previewLines } from './terminal-tail';

/** A Terminal opens in a Tab of its own unless it is opened into a Pane or Stack of an existing one. */
const newTab = (): TabId => TabId.make(crypto.randomUUID());

@Injectable({ providedIn: 'root' })
export class TerminalsState {
  private readonly all = signal<ReadonlyArray<TerminalEntry>>([]);
  readonly entries = this.all.asReadonly();
  /** The last activity main reported, kept for a Terminal whose entry is added after main already spoke of it. */
  private reported: ReadonlyArray<TerminalActivityEntry> = [];
  private readonly currentId = signal<TerminalId | undefined>(undefined);
  /** The Terminal a screen is showing now, whichever place shows it; none while no screen does. */
  private readonly shown = signal<TerminalId | undefined>(undefined);
  /** Each restart, old id to new, so a Tab's layout keeps the restarted Terminal in its place. For this app run only. */
  /** The Idle Terminals being started, so a second click cannot start one twice. */
  private readonly starting = new Set<TerminalId>();
  private readonly restartedIds = signal<ReadonlyMap<TerminalId, TerminalId>>(new Map());
  readonly restarts = this.restartedIds.asReadonly();
  /** For each Terminal a screen shows, how to read the lines that screen holds now. */
  private readonly tailReaders = new Map<TerminalId, () => ReadonlyArray<string>>();
  /** The lines a Terminal's screen held when it left the window. */
  private readonly savedTails = new Map<TerminalId, ReadonlyArray<string>>();
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
    // Main alone decides whether what is shown is on screen (it knows the Window mode), so this only says what is shown.
    effect(() => {
      const terminalId = this.shown();
      void this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Terminal.show'](terminalId === undefined ? {} : { terminalId })));
    });
  }

  /** A screen shows this Terminal. It replaces whatever was shown. */
  show(id: TerminalId): void {
    this.shown.set(id);
  }

  /** A screen stopped showing this Terminal. Nothing changes if another one has taken the screen since. */
  hide(id: TerminalId): void {
    this.shown.update((shown) => (shown === id ? undefined : shown));
  }

  /** Opens a shell in the folder; with a Provider, that Provider's CLI runs in it. */
  async createLive(projectId: ProjectId, cwd: string, provider?: Provider, tabId: TabId = newTab()): Promise<TerminalEntry | undefined> {
    const result = await this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        return yield* desktop['Terminal.create'](provider === undefined ? { cwd } : { cwd, provider });
      }),
    );
    if (result._tag === 'Failure') return undefined;
    const entry = addTerminal(this.all(), projectId, tabId, result.value.terminalId, provider).at(-1)!;
    this.all.update((entries) => pipe(withState([...entries, entry], entry.id, 'Live'), (next) => withActivity(next, this.reported)));
    this.currentId.set(entry.id);
    return { ...entry, state: 'Live' };
  }

  /**
   * Adds the Terminals saved by a previous run (Idle, not started; ADR 0011). One already here, opened before the saved
   * ones arrived, is kept as it is.
   */
  restore(saved: ReadonlyArray<TerminalEntry>): void {
    this.all.update((entries) => {
      const known = new Set(entries.map((entry) => entry.id));
      return [...entries, ...saved.filter((entry) => !known.has(entry.id))];
    });
  }

  /**
   * Starts an Idle Terminal (one restored, or one main could not start) in the Project folder, running its Provider's CLI
   * if it has one. It keeps its id, so it is the same Terminal it was before. Fails if it is not Idle, is already
   * starting, or main refuses.
   */
  async start(id: TerminalId, cwd: string): Promise<Exit.Exit<void, unknown>> {
    const entry = this.find(id);
    if (entry?.state !== 'Idle' || this.starting.has(id)) return Exit.fail(`Terminal ${id} is not Idle`);
    const provider = entry.provider;
    this.starting.add(id);
    const result = await this.runtime.run(
      Effect.gen(function* () {
        const desktop = yield* DesktopApi;
        return yield* desktop['Terminal.create'](provider === undefined ? { cwd, terminalId: id } : { cwd, provider, terminalId: id });
      }),
    );
    this.starting.delete(id);
    if (Exit.isFailure(result)) return result;
    this.all.update((entries) => pipe(withState(entries, id, 'Live'), (next) => withActivity(next, this.reported)));
    return Exit.void;
  }

  create(projectId: ProjectId, tabId: TabId = newTab()): TerminalEntry {
    const id = TerminalId.make(crypto.randomUUID());
    const entry = addTerminal(this.all(), projectId, tabId, id).at(-1)!;
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

  /** Keeps the screen of a Terminal that is leaving the window, so the next place that shows it can restore it. */
  saveScreen(id: TerminalId, screen: TerminalScreenSnapshot): void {
    this.all.update((entries) => withScreen(entries, id, screen));
  }

  /** A screen shows this Terminal: its last lines are read from that screen, as it is now. */
  attachTail(id: TerminalId, read: () => ReadonlyArray<string>): void {
    this.tailReaders.set(id, read);
  }

  /**
   * A screen stopped showing this Terminal: the lines it held are kept, unless the Terminal is gone (closed, or replaced
   * by a restart). Nothing changes if another screen has taken it since.
   */
  detachTail(id: TerminalId, read: () => ReadonlyArray<string>): void {
    if (this.tailReaders.get(id) !== read) return;
    this.tailReaders.delete(id);
    if (this.find(id) !== undefined) this.savedTails.set(id, read());
  }

  /** The last few lines of a Terminal's output: from the screen showing it, else from the last one that did. None if no screen has. */
  tailOf(id: TerminalId): ReadonlyArray<string> {
    return previewLines(this.tailReaders.get(id)?.() ?? this.savedTails.get(id) ?? []);
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
    this.restartedIds.update((ids) => new Map(ids).set(id, result.value.terminalId));
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
    this.tailReaders.delete(id);
    this.savedTails.delete(id);
  }
}
