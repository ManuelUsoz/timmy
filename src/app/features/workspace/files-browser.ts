import { DestroyRef, Injectable, InjectionToken, computed, effect, inject, signal, untracked } from '@angular/core';
import { Cause, Effect, Exit, Stream } from 'effect';
import { DEFAULT_BROWSER_WIDTH, type FolderEntry } from '../../../shared/files/files.model';
import type { Project, ProjectId } from '../../../shared/projects/projects.model';
import type { TerminalHookReport } from '../../../shared/terminal/terminal.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import type { TreeNode } from '../../shared/ui/tree-view/tree-view.types';
import { Changes, changedOnlyTree, flagOf, marks, withChanges } from './changed-files';
import { ProjectsState } from './projects-state';
import { TabsState } from './tabs-state';
import { TerminalsState } from './terminals-state';
import { WorkspaceLayoutState } from './workspace-layout';

/** The narrowest the sidebar gets, and the widest as a share of the window. */
export const MIN_BROWSER_WIDTH = 280;
export const MAX_BROWSER_SHARE = 0.6;
/** Most matches the filter lists. */
export const MAX_MATCHES = 200;
/** How long a burst of refresh triggers must be over before the changed markers are read again, in milliseconds. */
export const CHANGES_DEBOUNCE_MS = new InjectionToken<number>('CHANGES_DEBOUNCE_MS', { providedIn: 'root', factory: () => 300 });

/** The files git sees, for the filter: loading, not available (no git, or it failed), or the paths. */
type FileIndex =
  | { readonly status: 'loading' }
  | { readonly status: 'noGit' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly paths: ReadonlyArray<string>; readonly truncated: boolean };

export interface FileMatch {
  readonly path: string;
  readonly name: string;
  /** The folder it is in; '' at the root. */
  readonly dir: string;
}

/** What the filter shows. An empty result is `ready` with no items, never a failure. */
export type Matches =
  | { readonly status: 'loading' }
  | { readonly status: 'unavailable'; readonly reason: 'noGit' }
  | { readonly status: 'unavailable'; readonly reason: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly items: ReadonlyArray<FileMatch>; readonly truncated: boolean };

const toMatch = (path: string): FileMatch => {
  const slash = path.lastIndexOf('/');
  return { path, name: path.slice(slash + 1), dir: slash === -1 ? '' : path.slice(0, slash) };
};

/** What reading one folder gave. `gone` only lasts until it is forgotten: the folder was deleted since it was remembered. */
type Dir =
  | { readonly status: 'loading' }
  | { readonly status: 'gone' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly entries: ReadonlyArray<FolderEntry> };

/** Loading, failure, empty and success stay apart: a failure is never shown as an empty Project. */
export type FilesTree =
  | { readonly status: 'loading' }
  | { readonly status: 'failed'; readonly detail: string }
  | { readonly status: 'ready'; readonly nodes: ReadonlyArray<TreeNode> };

const join = (dir: string, name: string): string => (dir === '' ? name : `${dir}/${name}`);

/**
 * The Files browser (GLOSSARY: Files browser): whether the sidebar is open, the tree of the selected Project, and what it
 * remembers of that Project. Folders are read when the user opens them, never ahead. The sidebar (`FilesSidebar`) shows it.
 */
@Injectable({ providedIn: 'root' })
export class FilesBrowser {
  private readonly runtime = inject(EffectRuntime);
  private readonly i18n = inject(I18n);
  private readonly projects = inject(ProjectsState);
  private readonly layout = inject(WorkspaceLayoutState);
  private readonly tabs = inject(TabsState);
  private readonly terminals = inject(TerminalsState);
  private readonly debounce = inject(CHANGES_DEBOUNCE_MS);
  private readonly t = (key: Parameters<I18n['t']>[0], params?: Parameters<I18n['t']>[1]): string => this.i18n.t(key, params);

  /** Open for the whole window; what it shows follows the selected Project. */
  readonly open = signal(false);
  /** The width the user chose, the same for every Project. */
  readonly width = signal(DEFAULT_BROWSER_WIDTH);
  /** The widest the sidebar gets: a share of the window, never under the narrowest. */
  readonly maxWidth = computed(() => Math.max(MIN_BROWSER_WIDTH, Math.floor(this.layout.width() * MAX_BROWSER_SHARE)));
  /** The width on screen: the chosen one kept between the narrowest and the widest. */
  readonly shownWidth = computed(() => Math.min(Math.max(this.width(), MIN_BROWSER_WIDTH), this.maxWidth()));
  /** What the user typed in the filter field. Not remembered. */
  readonly filter = signal('');
  private readonly index = signal<FileIndex>({ status: 'loading' });
  readonly matches = computed((): Matches => {
    const index = this.index();
    if (index.status === 'loading') return { status: 'loading' };
    if (index.status === 'noGit') return { status: 'unavailable', reason: 'noGit' };
    if (index.status === 'failed') return { status: 'unavailable', reason: 'failed', detail: index.detail };
    const needle = this.filter().trim().toLowerCase();
    const found = needle === '' ? [] : index.paths.filter((path) => path.toLowerCase().includes(needle));
    return { status: 'ready', items: found.slice(0, MAX_MATCHES).map(toMatch), truncated: found.length > MAX_MATCHES || index.truncated };
  });

  private readonly dirs = signal<ReadonlyMap<string, Dir>>(new Map());
  private readonly expanded = signal<ReadonlyArray<string>>([]);
  private readonly lastFile = signal<string | null>(null);
  /** The last file picked: only the tree's highlight. The file itself is read in a File View (ADR 0013). */
  readonly selected = this.lastFile.asReadonly();

  /** The Project being shown (its state may still be arriving), so asking again does not start over. */
  private activeFor: ProjectId | undefined;
  /** The Project whose remembered state has arrived: only then may a change be remembered. */
  private loadedFor: ProjectId | undefined;
  /** A count that tells a stale answer from a current one. */
  private generation = 0;

  /**
   * The Changed files of the Project from its last `git status` that worked. None before the first one: a folder that is not
   * a repository, or a status that fails, shows no markers rather than an error.
   */
  private readonly changes = signal(new Changes([]));
  /** How many Changed files the Project has ("N con cambios"). */
  readonly changedCount = computed(() => this.changes().entries.length);
  private readonly showChangedOnly = signal(false);
  /** Whether the tree shows only the changed paths and the folders that lead to them. */
  readonly changedOnly = computed(() => this.showChangedOnly() && this.changedCount() > 0);
  /** The wait for a burst of refresh triggers to end, and whether a status is running or must run again after it. */
  private changesTimer: ReturnType<typeof setTimeout> | undefined;
  private changesRunning = false;
  private changesAgain = false;

  readonly tree = computed((): FilesTree => {
    const root = this.dirs().get('');
    if (root === undefined || root.status === 'loading') return { status: 'loading' };
    if (root.status === 'failed') return { status: 'failed', detail: root.detail };
    if (root.status === 'gone') return { status: 'failed', detail: this.projects.selected()?.cwd ?? '' };
    if (this.changedOnly()) return { status: 'ready', nodes: changedOnlyTree(this.changes(), this.t) };
    return { status: 'ready', nodes: this.nodesOf('', new Set(this.expanded())) };
  });

  constructor() {
    // Another Project selected while the sidebar is open: it shows that Project's tree.
    effect(() => {
      const projectId = this.projects.selectedId();
      untracked(() => {
        if (this.open() && projectId !== undefined) this.activate();
      });
    });
    // The markers follow what the agents do (a tool use, a stop) and what no Hook sees (the user back in the window). No
    // timer and no watcher: an idle Project costs nothing.
    const stop = new AbortController();
    const onFocus = () => this.refreshChanges();
    window.addEventListener('focus', onFocus);
    inject(DestroyRef).onDestroy(() => {
      stop.abort();
      window.removeEventListener('focus', onFocus);
      clearTimeout(this.changesTimer);
    });
    void this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) => Stream.runForEach(desktop['Terminal.hookReports'](), (report) => Effect.sync(() => this.heard(report)))),
      { signal: stop.signal },
    );
  }

  /** "N con cambios": the tree of only the changed paths, or back to the whole tree. */
  toggleChangedOnly(): void {
    if (this.changedCount() > 0) this.showChangedOnly.update((only) => !only);
  }

  /**
   * Asks for the markers again. Triggers that come close together become one `git status`, run when they stop; only one runs
   * at a time, and one that comes while it runs makes it run once more after.
   */
  refreshChanges(): void {
    if (!this.open() || this.projects.selected() === undefined) return;
    clearTimeout(this.changesTimer);
    this.changesTimer = setTimeout(() => {
      this.changesTimer = undefined;
      void this.readChanges();
    }, this.debounce);
  }

  /** A Hook said an agent used a tool or stopped: the files of its Project may have changed. */
  private heard(report: TerminalHookReport): void {
    if (report.signal !== 'Working' && report.signal !== 'Done') return;
    const projectId = this.terminals.find(report.terminalId)?.projectId;
    if (projectId !== undefined && projectId === this.projects.selectedId()) this.refreshChanges();
  }

  private async readChanges(): Promise<void> {
    const project = this.projects.selected();
    if (project === undefined) return;
    if (this.changesRunning) {
      this.changesAgain = true;
      return;
    }
    const generation = this.generation;
    this.changesRunning = true;
    const exit = await this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Files.changes']({ cwd: project.cwd })));
    this.changesRunning = false;
    // A failure keeps the last markers, silently: they are a hint, not something to report.
    if (generation === this.generation && Exit.isSuccess(exit)) {
      this.changes.set(new Changes(exit.value.entries));
      if (exit.value.entries.length === 0) this.showChangedOnly.set(false);
    }
    if (this.changesAgain) {
      this.changesAgain = false;
      this.refreshChanges();
    }
  }

  /** Ticks each time the filter should take the keyboard (Ctrl+P); the sidebar focuses the field on every tick. */
  readonly filterFocus = signal(0);

  /** The Files icon. Opening needs a Project in view: without one there is nothing to browse. */
  toggle(): void {
    if (!this.open() && this.projects.selected() === undefined) return;
    this.open.update((open) => !open);
    if (!this.open()) return;
    this.activate();
    this.refreshChanges();
  }

  /** Ctrl+P: open on the tree with the filter ready, wherever the sidebar was. */
  openWithFilter(): void {
    if (!this.open()) this.toggle();
    if (!this.open()) return;
    this.filterFocus.update((count) => count + 1);
  }

  /**
   * Opens or closes a folder of the tree. It is read the first time it opens, and again only after a refresh. A chain of
   * single-child folders is one row whose id is its first folder: the whole chain opens and closes with it.
   */
  setFolderOpen(path: string, open: boolean): void {
    // The changed-only tree is all open and its folders are not the tree's: closing one there is not remembered.
    if (this.changedOnly() || open === this.expanded().includes(path)) return;
    const chain = this.chainOf(path, this.entryAt(path)?.ignored ?? false);
    if (open) this.openFolders(chain);
    else this.expanded.update((list) => list.filter((entry) => !chain.includes(entry)));
    this.persist();
  }

  /**
   * A row of the tree was picked: a file opens as a File View, a preview on a click and pinned with `pin` (a double
   * click); a folder (the tree opens it), a status row or a deleted file (there is nothing to read) does nothing.
   */
  pick(path: string, pin = false): void {
    const changes = this.changes();
    if (changes.kindOf(path) === 'deleted') return;
    const listed = this.entryAt(path)?.kind;
    const changedFile = changes.entries.some((entry) => entry.path === path && !entry.folder);
    if (listed === 'file' || (listed === undefined && changedFile)) this.openFile(path, pin);
  }

  /**
   * What a folder holds: its listing once read, with what git says it holds that the listing lacks (a deleted file, a file
   * or folder newer than the listing). A folder gone from disk still holds what git says was deleted in it.
   */
  private entriesOf(dir: string): ReadonlyArray<FolderEntry> | undefined {
    const listing = this.dirs().get(dir);
    if (listing?.status === 'ready') return withChanges(listing.entries, dir, this.changes());
    if (listing?.status === 'gone' && this.changes().childrenOf(dir).length > 0) return withChanges([], dir, this.changes());
    return undefined;
  }

  /** The entry at `path` as its folder holds it, if that folder has been read. */
  private entryAt(path: string): FolderEntry | undefined {
    const slash = path.lastIndexOf('/');
    const dir = slash === -1 ? '' : path.slice(0, slash);
    return this.entriesOf(dir)?.find((candidate) => join(dir, candidate.name) === path);
  }

  /** The only entry of a folder that has been read, when that entry is a folder git sees the same way; else nothing. */
  private onlyChildFolder(path: string, ignored: boolean): string | undefined {
    const entries = this.entriesOf(path);
    if (entries?.length !== 1) return undefined;
    const [only] = entries;
    return only.kind === 'folder' && only.ignored === ignored ? join(path, only.name) : undefined;
  }

  /**
   * The folders shown as one row from `path` down: `path`, then its only child while that child is a folder, as far as the
   * folders read so far tell. An ignored folder does not join the chain of one git sees, nor the other way round.
   */
  private chainOf(path: string, ignored: boolean): ReadonlyArray<string> {
    const chain = [path];
    for (let next = this.onlyChildFolder(path, ignored); next !== undefined; next = this.onlyChildFolder(next, ignored)) chain.push(next);
    return chain;
  }

  /**
   * Picks a file: it opens as a File View in the Tab on screen (`TabsState.openFile`), a preview unless `pin`, and the
   * tree highlights it. With no Tab of the Project on screen there is nowhere to open it: a Tab exists only while it has
   * a Terminal.
   */
  openFile(path: string, pin = false): void {
    const project = this.projects.selected();
    if (project === undefined) return;
    this.lastFile.set(path);
    this.persist();
    const current = this.terminals.current();
    const tab = current?.projectId === project.projectId ? this.tabs.tabsOf(project.projectId).find((each) => each.id === current.tabId) : undefined;
    if (tab !== undefined) this.tabs.openFile(tab, path, pin);
  }

  /** Esc inside the sidebar closes it. */
  escape(): void {
    this.open.set(false);
  }

  /** The user drags the edge: a width that fits the window as it is now. */
  setWidth(pixels: number): void {
    this.width.set(Math.min(Math.max(Math.round(pixels), MIN_BROWSER_WIDTH), this.maxWidth()));
  }

  /**
   * The user let go of the edge: remember the width, for every Project. It is the width the user chose, not the one shown:
   * a small window shows less than they asked for, and must not overwrite what they asked for.
   */
  saveWidth(): void {
    const width = this.width();
    void this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Files.saveWidth']({ width })));
  }

  /** Reads again the root, the open folders and the index. What is on screen stays until the new answer. */
  async refresh(): Promise<void> {
    const project = this.projects.selected();
    if (project === undefined || this.loadedFor !== project.projectId) return;
    const generation = this.generation;
    const open = this.expanded();
    // A closed folder is read again when it is next opened.
    this.dirs.update((map) => new Map([...map].filter(([dir]) => dir === '' || open.includes(dir))));
    this.refreshChanges();
    await Promise.all([...['', ...open].map((dir) => this.loadDir(project, dir, true)), this.loadIndex(project, generation)]);
    if (generation === this.generation) this.forgetGone(open);
  }

  /** Marks folders open, in order, and reads those not read yet (or that failed). Does not remember. */
  private openFolders(paths: ReadonlyArray<string>): void {
    const project = this.projects.selected();
    this.expanded.update((list) => [...list, ...paths.filter((path) => !list.includes(path))]);
    for (const path of paths) {
      const known = this.dirs().get(path);
      if (project !== undefined && (known === undefined || known.status === 'failed')) void this.loadDir(project, path);
    }
  }

  private nodesOf(dir: string, open: ReadonlySet<string>): ReadonlyArray<TreeNode> {
    const changes = this.changes();
    return (this.entriesOf(dir) ?? []).map((entry): TreeNode => {
      const path = join(dir, entry.name);
      const dimmed = entry.ignored ? { dimmed: true } : {};
      if (entry.kind === 'file') return { id: path, label: entry.name, kind: 'file', ...dimmed, ...marks(changes, path, this.t) };
      // A chain of single-child folders is one row: named by the whole chain, showing what the last folder holds.
      const chain = this.chainOf(path, entry.ignored);
      const last = chain[chain.length - 1];
      const isOpen = open.has(path);
      // A closed folder says how many changes it holds; an open one shows them instead.
      const flag = flagOf(changes, last, !isOpen, this.t);
      return {
        id: path,
        label: dir === '' ? last : last.slice(dir.length + 1),
        kind: 'folder',
        lazy: true,
        expanded: isOpen,
        ...dimmed,
        ...(flag ? { flag } : {}),
        ...(isOpen ? { children: this.childrenOf(last, open) } : {}),
      };
    });
  }

  /** What an open folder shows: its entries, or one row that says it is loading or could not be read. */
  private childrenOf(path: string, open: ReadonlySet<string>): ReadonlyArray<TreeNode> {
    if (this.entriesOf(path) !== undefined) return this.nodesOf(path, open);
    const listing = this.dirs().get(path);
    if (listing === undefined || listing.status === 'loading') {
      return [{ id: `${path}/\u0000loading`, label: this.i18n.t('files.loading'), disabled: true }];
    }
    if (listing.status === 'gone') {
      return [{ id: `${path}/\u0000gone`, label: this.i18n.t('files.folderGone'), disabled: true }];
    }
    if (listing.status === 'failed') {
      return [{ id: `${path}/\u0000failed`, label: this.i18n.t('files.folderFailed', { detail: listing.detail }), disabled: true }];
    }
    return this.nodesOf(path, open);
  }

  /** Loads the remembered state of the selected Project, then its root and every folder it had open. */
  private activate(): void {
    const project = this.projects.selected();
    if (project === undefined || this.activeFor === project.projectId) return;
    this.generation++;
    this.activeFor = project.projectId;
    this.loadedFor = undefined;
    this.dirs.set(new Map([['', { status: 'loading' }]]));
    this.expanded.set([]);
    this.lastFile.set(null);
    this.filter.set('');
    this.index.set({ status: 'loading' });
    this.changes.set(new Changes([]));
    this.showChangedOnly.set(false);
    this.refreshChanges();
    void this.restore(project, this.generation);
    void this.loadIndex(project, this.generation);
  }

  private async loadIndex(project: Project, generation: number): Promise<void> {
    const exit = await this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) => desktop['Files.list']({ cwd: project.cwd })).pipe(
        Effect.map((list): FileIndex => ({ status: 'ready', paths: list.paths, truncated: list.truncated })),
        Effect.catchTag('FilesError', (error) =>
          Effect.succeed<FileIndex>(error.reason === 'NotAGitRepository' ? { status: 'noGit' } : { status: 'failed', detail: error.detail }),
        ),
      ),
    );
    if (generation !== this.generation) return;
    this.index.set(Exit.isSuccess(exit) ? exit.value : { status: 'failed', detail: Cause.pretty(exit.cause) });
  }

  /** Folders that turned out to be gone drop out of the open ones, and the browser remembers that. */
  private forgetGone(asked: ReadonlyArray<string>): void {
    // A folder gone from disk that still holds a deleted file stays: git says what was in it.
    const gone = asked.filter((dir) => this.dirs().get(dir)?.status === 'gone' && this.entriesOf(dir) === undefined);
    if (gone.length === 0) return;
    this.expanded.update((list) => list.filter((dir) => !gone.includes(dir)));
    this.persist();
  }

  private async restore(project: Project, generation: number): Promise<void> {
    const exit = await this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Files.getState']({ projectId: project.projectId })));
    if (generation !== this.generation) return;
    // Without its remembered state the browser starts fresh; the tree still works.
    const saved = Exit.isSuccess(exit) ? exit.value : undefined;
    if (saved !== undefined) this.width.set(saved.width);
    const wanted = saved?.expanded ?? [];
    this.expanded.set(wanted);
    this.lastFile.set(saved?.lastFile ?? null);
    this.loadedFor = project.projectId;
    await Promise.all(['', ...wanted].map((dir) => this.loadDir(project, dir)));
    if (generation !== this.generation) return;
    // A folder that is gone drops out of the tree.
    this.forgetGone(wanted);
  }

  /** Reads one folder. `keepVisible` leaves what is already shown in place until the answer, as a refresh does. */
  private async loadDir(project: Project, dir: string, keepVisible = false): Promise<void> {
    const generation = this.generation;
    if (!keepVisible) this.dirs.update((map) => new Map(map).set(dir, { status: 'loading' }));
    const exit = await this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) => desktop['Files.listDir']({ cwd: project.cwd, dir })).pipe(
        Effect.map((listing): Dir => ({ status: 'ready', entries: listing.entries })),
        Effect.catchTag('FilesError', (error) =>
          Effect.succeed<Dir>(error.reason === 'FolderNotFound' ? { status: 'gone' } : { status: 'failed', detail: error.detail }),
        ),
      ),
    );
    if (generation !== this.generation) return;
    const result: Dir = Exit.isSuccess(exit) ? exit.value : { status: 'failed', detail: Cause.pretty(exit.cause) };
    this.dirs.update((map) => new Map(map).set(dir, result));
    this.followChains();
  }

  /**
   * An open folder that turns out to start a chain of single-child folders opens the rest of the chain, as one row does, and
   * remembers it. Run after every read: a listing that arrives may lengthen a chain, or tell whether its first folder is ignored.
   * Only folders on screen are followed: one remembered open inside a closed folder is left as it is, unread.
   */
  private followChains(): void {
    const open = this.expanded();
    const shown = (path: string): boolean => {
      const parts = path.split('/');
      return parts.slice(1).every((_, index) => open.includes(parts.slice(0, index + 1).join('/')));
    };
    const missing = open.flatMap((path) => {
      const entry = shown(path) ? this.entryAt(path) : undefined;
      return entry === undefined ? [] : this.chainOf(path, entry.ignored).filter((member) => !open.includes(member));
    });
    if (missing.length === 0) return;
    this.openFolders([...new Set(missing)]);
    this.persist();
  }

  /** Remembers the Project's state in main. Fire and forget: failing to remember must not get in the user's way. */
  private persist(): void {
    const projectId = this.loadedFor;
    if (projectId === undefined) return;
    void this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) =>
        desktop['Files.saveState']({ projectId, expanded: this.expanded(), lastFile: this.lastFile() }),
      ),
    );
  }
}
