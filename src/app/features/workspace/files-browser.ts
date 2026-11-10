import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import { DEFAULT_BROWSER_WIDTH, type FolderEntry } from '../../../shared/files/files.model';
import type { Project, ProjectId } from '../../../shared/projects/projects.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import type { TreeNode } from '../../shared/ui/tree-view/tree-view.types';
import { ProjectsState } from './projects-state';
import { WorkspaceLayoutState } from './workspace-layout';

/** The narrowest the sidebar gets, and the widest as a share of the window. */
export const MIN_BROWSER_WIDTH = 280;
export const MAX_BROWSER_SHARE = 0.6;
/** Most matches the filter lists. */
export const MAX_MATCHES = 200;

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

/** What reading the open file gave. `gone` is a file deleted since it was remembered or listed. */
export type FileState =
  | { readonly status: 'none' }
  | { readonly status: 'loading'; readonly path: string }
  | { readonly status: 'text'; readonly path: string; readonly content: string }
  | { readonly status: 'binary'; readonly path: string }
  | { readonly status: 'tooLarge'; readonly path: string; readonly size: number }
  | { readonly status: 'gone'; readonly path: string }
  | { readonly status: 'unreadable'; readonly path: string }
  | { readonly status: 'failed'; readonly path: string; readonly detail: string };

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
  private readonly mode = signal<'tree' | 'file'>('tree');
  /** Whether the sidebar shows the tree or the file picked in it. */
  readonly view = this.mode.asReadonly();
  /** The last file picked: highlighted in the tree, and the one the file view reads. */
  readonly selected = this.lastFile.asReadonly();
  private readonly fileState = signal<FileState>({ status: 'none' });
  readonly file = this.fileState.asReadonly();

  /** The Project being shown (its state may still be arriving), so asking again does not start over. */
  private activeFor: ProjectId | undefined;
  /** The Project whose remembered state has arrived: only then may a change be remembered. */
  private loadedFor: ProjectId | undefined;
  /** A count that tells a stale answer from a current one. */
  private generation = 0;

  readonly tree = computed((): FilesTree => {
    const root = this.dirs().get('');
    if (root === undefined || root.status === 'loading') return { status: 'loading' };
    if (root.status === 'failed') return { status: 'failed', detail: root.detail };
    if (root.status === 'gone') return { status: 'failed', detail: this.projects.selected()?.cwd ?? '' };
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
  }

  /** Ticks each time the filter should take the keyboard (Ctrl+P); the sidebar focuses the field on every tick. */
  readonly filterFocus = signal(0);

  /** The Files icon. Opening needs a Project in view: without one there is nothing to browse. */
  toggle(): void {
    if (!this.open() && this.projects.selected() === undefined) return;
    this.open.update((open) => !open);
    if (this.open()) this.activate();
  }

  /** Ctrl+P: open on the tree with the filter ready, wherever the sidebar was. */
  openWithFilter(): void {
    if (!this.open()) this.toggle();
    if (!this.open()) return;
    if (this.mode() === 'file') this.back();
    this.filterFocus.update((count) => count + 1);
  }

  /**
   * Opens or closes a folder of the tree. It is read the first time it opens, and again only after a refresh. A chain of
   * single-child folders is one row whose id is its first folder: the whole chain opens and closes with it.
   */
  setFolderOpen(path: string, open: boolean): void {
    if (open === this.expanded().includes(path)) return;
    const chain = this.chainOf(path, this.entryAt(path)?.ignored ?? false);
    if (open) this.openFolders(chain);
    else this.expanded.update((list) => list.filter((entry) => !chain.includes(entry)));
    this.persist();
  }

  /** A row of the tree was picked: a file opens; a folder (the tree opens it) or a status row does nothing. */
  pick(path: string): void {
    if (this.entryAt(path)?.kind === 'file') this.openFile(path);
  }

  /** The entry at `path` as its folder listed it, if that folder has been read. */
  private entryAt(path: string): FolderEntry | undefined {
    const slash = path.lastIndexOf('/');
    const dir = slash === -1 ? '' : path.slice(0, slash);
    const parent = this.dirs().get(dir);
    return parent?.status === 'ready' ? parent.entries.find((candidate) => join(dir, candidate.name) === path) : undefined;
  }

  /** The only entry of a folder that has been read, when that entry is a folder git sees the same way; else nothing. */
  private onlyChildFolder(path: string, ignored: boolean): string | undefined {
    const listing = this.dirs().get(path);
    if (listing?.status !== 'ready' || listing.entries.length !== 1) return undefined;
    const [only] = listing.entries;
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

  /** Picks a file: the sidebar shows it, read now, and remembers it. */
  openFile(path: string): void {
    const project = this.projects.selected();
    if (project === undefined) return;
    this.lastFile.set(path);
    this.mode.set('file');
    // Picked from the filter: Back should find the whole tree, not the search.
    this.filter.set('');
    void this.readFile(project, path, this.generation);
    this.persist();
  }

  /** Back to the tree from a file, with the file highlighted and the folders it lives in open. */
  back(): void {
    this.mode.set('tree');
    const path = this.lastFile();
    if (path !== null) {
      const parts = path.split('/').slice(0, -1);
      this.openFolders(parts.map((_, index) => parts.slice(0, index + 1).join('/')));
    }
    this.persist();
  }

  /** Esc inside the sidebar: out of a file first, then out of the sidebar. */
  escape(): void {
    if (this.mode() === 'file') this.back();
    else this.open.set(false);
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
    const listing = this.dirs().get(dir);
    if (listing?.status !== 'ready') return [];
    return listing.entries.map((entry): TreeNode => {
      const path = join(dir, entry.name);
      const dimmed = entry.ignored ? { dimmed: true } : {};
      if (entry.kind === 'file') return { id: path, label: entry.name, kind: 'file', ...dimmed };
      // A chain of single-child folders is one row: named by the whole chain, showing what the last folder holds.
      const chain = this.chainOf(path, entry.ignored);
      const last = chain[chain.length - 1];
      const isOpen = open.has(path);
      return {
        id: path,
        label: dir === '' ? last : last.slice(dir.length + 1),
        kind: 'folder',
        lazy: true,
        expanded: isOpen,
        ...dimmed,
        ...(isOpen ? { children: this.childrenOf(last, open) } : {}),
      };
    });
  }

  /** What an open folder shows: its entries, or one row that says it is loading or could not be read. */
  private childrenOf(path: string, open: ReadonlySet<string>): ReadonlyArray<TreeNode> {
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
    this.mode.set('tree');
    this.fileState.set({ status: 'none' });
    this.filter.set('');
    this.index.set({ status: 'loading' });
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
    const gone = asked.filter((dir) => this.dirs().get(dir)?.status === 'gone');
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
    this.mode.set(saved?.view ?? 'tree');
    this.loadedFor = project.projectId;
    const remembered = this.mode() === 'file' ? this.lastFile() : null;
    await Promise.all([
      ...['', ...wanted].map((dir) => this.loadDir(project, dir)),
      ...(remembered === null ? [] : [this.readFile(project, remembered, generation)]),
    ]);
    if (generation !== this.generation) return;
    // What is gone is forgotten: a folder drops out of the tree, a file sends the sidebar back to the tree.
    this.forgetGone(wanted);
    if (remembered !== null && this.fileState().status === 'gone') {
      this.lastFile.set(null);
      this.mode.set('tree');
      this.fileState.set({ status: 'none' });
      this.persist();
    }
  }

  private async readFile(project: Project, path: string, generation: number): Promise<void> {
    this.fileState.set({ status: 'loading', path });
    const exit = await this.runtime.run(
      Effect.flatMap(DesktopApi, (desktop) => desktop['Files.read']({ cwd: project.cwd, file: path })).pipe(
        Effect.map((content): FileState => {
          switch (content.kind) {
            case 'text':
              return { status: 'text', path, content: content.content };
            case 'binary':
              return { status: 'binary', path };
            case 'tooLarge':
              return { status: 'tooLarge', path, size: content.size };
          }
        }),
        Effect.catchTag('FilesError', (error) =>
          Effect.succeed<FileState>(
            error.reason === 'FileNotFound'
              ? { status: 'gone', path }
              : error.reason === 'Unreadable'
                ? { status: 'unreadable', path }
                : { status: 'failed', path, detail: error.detail },
          ),
        ),
      ),
    );
    // Another file was picked, or another Project selected, while this one was being read.
    if (generation !== this.generation || this.lastFile() !== path) return;
    this.fileState.set(Exit.isSuccess(exit) ? exit.value : { status: 'failed', path, detail: Cause.pretty(exit.cause) });
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
   */
  private followChains(): void {
    const open = this.expanded();
    const missing = open.flatMap((path) => {
      const entry = this.entryAt(path);
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
        desktop['Files.saveState']({ projectId, expanded: this.expanded(), lastFile: this.lastFile(), view: this.mode() }),
      ),
    );
  }
}
