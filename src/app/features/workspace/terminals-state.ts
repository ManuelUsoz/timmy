import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { Effect, Exit, Stream, pipe } from 'effect';
import type { RpcClientError } from 'effect/rpc';
import type { ProjectId } from '../../../shared/projects/projects.model';
import type { Provider } from '../../../shared/settings/settings.model';
import { TerminalId, type TerminalActivityEntry } from '../../../shared/terminal/terminal.model';
import { isTerminalNameTaken } from '../../../shared/workspace/terminal-name';
import { WorkspaceError } from '../../../shared/workspace/workspace-error.model';
import { DesktopApi } from '../../core/desktop-api';
import type { DesktopBridgeError } from '../../core/desktop-error';
import { EffectRuntime } from '../../core/effect-runtime';
import { TabId } from './tabs';
import {
  addTerminal,
  renumberedAfter,
  restarted,
  terminalsOf,
  withActivity,
  withExit,
  withName,
  withScreen,
  withState,
  type TerminalEntry,
  type TerminalScreenSnapshot,
  type TerminalState,
} from './terminal-entries';
import { previewLines } from './terminal-tail';

/** A Terminal opens in a Tab of its own unless it is opened into a Pane or Stack of an existing one. */
const newTab = (): TabId => TabId.make(crypto.randomUUID());

@Injectable({ providedIn: 'root' })
export class TerminalsState {
  private readonly all = signal<ReadonlyArray<TerminalEntry>>([]);
  readonly entries = this.all.asReadonly();
  /** The highest number each Project has given a Terminal, closed ones included: numbers are never reused. */
  private readonly lastNumbers = signal<ReadonlyMap<ProjectId, number>>(new Map());
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
    const entry = this.newEntry(projectId, tabId, result.value.terminalId, provider);
    this.all.update((entries) => pipe(withState([...entries, entry], entry.id, 'Live'), (next) => withActivity(next, this.reported)));
    this.currentId.set(entry.id);
    return { ...entry, state: 'Live' };
  }

  /**
   * Adds the Terminals saved by a previous run (Idle, not started; ADR 0011) and the highest number each Project had
   * given, so no number is given twice. One already here, opened before the saved ones arrived, is kept; it was numbered
   * without knowing them, so it takes the Project's next number (and the default name that goes with it, unless renamed).
   */
  restore(saved: ReadonlyArray<TerminalEntry>, given: ReadonlyMap<ProjectId, number> = new Map()): void {
    this.all.update((entries) => {
      const known = new Set(entries.map((entry) => entry.id));
      return [...renumberedAfter(entries, given), ...saved.filter((entry) => !known.has(entry.id))];
    });
    this.lastNumbers.update((numbers) => {
      const next = new Map(numbers);
      for (const [projectId, last] of given) next.set(projectId, Math.max(last, next.get(projectId) ?? 0));
      return next;
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
    const entry = this.newEntry(projectId, tabId, TerminalId.make(crypto.randomUUID()));
    this.all.update((entries) => [...entries, entry]);
    return entry;
  }

  /** A new entry with the Project's next number and its default name; the number counts as given from now on. */
  private newEntry(projectId: ProjectId, tabId: TabId, id: TerminalId, provider?: Provider): TerminalEntry {
    const entry = addTerminal(this.all(), projectId, tabId, id, provider, this.lastNumbers().get(projectId) ?? 0).at(-1)!;
    this.lastNumbers.update((numbers) => new Map(numbers).set(projectId, entry.number));
    return entry;
  }

  /** The highest number the Project has given a Terminal, closed ones included: the next one is numbered after it. */
  lastNumberOf(projectId: ProjectId): number {
    return terminalsOf(this.all(), projectId).reduce((max, entry) => Math.max(max, entry.number), this.lastNumbers().get(projectId) ?? 0);
  }

  /**
   * The user renames a Terminal. The name is trimmed; the same name leaves it as it is. Refused, with nothing changed,
   * when it is blank or another Terminal of the Project has it, ignoring case, here or in what main saved.
   */
  async rename(id: TerminalId, name: string): Promise<Exit.Exit<void, WorkspaceError | RpcClientError.RpcClientError | DesktopBridgeError>> {
    const entry = this.find(id);
    const trimmed = name.trim();
    if (entry === undefined || trimmed === entry.name) return Exit.void;
    if (trimmed === '') return Exit.fail(new WorkspaceError({ reason: 'NameEmpty', detail: `Terminal ${id} cannot be named blank` }));
    const others = terminalsOf(this.all(), entry.projectId).filter((other) => other.id !== id);
    if (isTerminalNameTaken(others.map((other) => other.name), trimmed)) {
      return Exit.fail(new WorkspaceError({ reason: 'NameTaken', detail: `Another Terminal of ${entry.projectId} is called ${trimmed}` }));
    }
    const result = await this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) => desktop['Workspace.renameTerminal']({ projectId: entry.projectId, number: entry.number, name: trimmed })),
    );
    if (Exit.isFailure(result)) return result;
    this.all.update((entries) => withName(entries, id, trimmed));
    return Exit.void;
  }

  find(id: string): TerminalEntry | undefined {
    return this.all().find((entry) => entry.id === id);
  }

  /** Makes a Terminal the current one; an id that is not (or no longer) a Terminal leaves the current one as it is. */
  setCurrent(id: TerminalId): void {
    if (this.find(id) === undefined) return;
    this.currentId.set(id);
    this.stampFocus(id);
  }

  /** When each Terminal was last the current one, as a count that grows with each: a Mention's default (ADR 0008). */
  private readonly focusStamps = signal<ReadonlyMap<TerminalId, number>>(new Map());
  private focusCount = 0;

  private stampFocus(id: TerminalId): void {
    if (this.focusStamps().get(id) === this.focusCount && this.focusCount > 0) return;
    this.focusCount += 1;
    const count = this.focusCount;
    this.focusStamps.update((stamps) => new Map(stamps).set(id, count));
  }

  /** How recently the Terminal was the current one: higher is more recent, 0 never. */
  focusedAt(id: TerminalId): number {
    return this.focusStamps().get(id) ?? 0;
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
    const stamp = this.focusStamps().get(id);
    if (stamp !== undefined) this.focusStamps.update((stamps) => new Map(stamps).set(result.value.terminalId, stamp));
    return this.find(result.value.terminalId);
  }

  async write(id: TerminalId, data: string): Promise<boolean> {
    const exit = await this.runtime.run(Effect.gen(function* () {
      const desktop = yield* DesktopApi;
      yield* desktop['Terminal.write']({ terminalId: id, data });
    }));
    return Exit.isSuccess(exit);
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
