import { ChangeDetectionStrategy, Component, ElementRef, Injector, InjectionToken, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import type { ProjectId } from '../../../shared/projects/projects.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { FileDiffView, readDiff, type DiffState } from './file-diff';
import { PLAIN_TEXT, languageOf } from './file-language';
import { LineSelections, clampLines, clickLine, isOnlyLine, lineRange, pathWithLines, rangeFrom, selectedText, type LineSelection } from './line-selection';
import { MentionButton } from './mention-button';
import { columnsOf, eolOf, indentOf, lineRuns, linesOf, type ColourRange } from './source-text';
import { SYMBOL_OUTLINER, type Outline } from './symbol-outline';
import { MAX_COLOURED_LENGTH, SYNTAX_HIGHLIGHTER } from './syntax-highlighter';
import { fileOf } from './views';
import { ChangesRefreshSource } from './changes-refresh';
import type { TabId } from './tabs';
import { TabsState } from './tabs-state';

/** How long a burst of diff refresh triggers must be over before the diff is read again, in milliseconds. */
export const DIFF_REFRESH_DEBOUNCE_MS = new InjectionToken<number>('DIFF_REFRESH_DEBOUNCE_MS', { providedIn: 'root', factory: () => 300 });

/** What reading the file of a File View gave. `gone` is a file deleted since it was listed or opened. */
export type FileState =
  | { readonly status: 'loading' }
  | { readonly status: 'text'; readonly content: string }
  | { readonly status: 'binary' }
  | { readonly status: 'tooLarge'; readonly size: number }
  | { readonly status: 'gone' }
  | { readonly status: 'unreadable' }
  | { readonly status: 'failed'; readonly detail: string };

/** Reads a file of the Project into what a File View shows; what main says of a file it cannot show is one of the states. */
const readFile = (cwd: string, file: string) =>
  Effect.flatMap(DesktopApi, (desktop) => desktop['Files.read']({ cwd, file })).pipe(
    Effect.map((content): FileState => {
      switch (content.kind) {
        case 'text':
          return { status: 'text', content: content.content };
        case 'binary':
          return { status: 'binary' };
        case 'tooLarge':
          return { status: 'tooLarge', size: content.size };
      }
    }),
    Effect.catchTag('FilesError', (error) =>
      Effect.succeed<FileState>(
        error.reason === 'FileNotFound' ? { status: 'gone' } : error.reason === 'Unreadable' ? { status: 'unreadable' } : { status: 'failed', detail: error.detail },
      ),
    ),
  );

/** Asks main to open a file of the Project outside Timmy, with the app the system has for it. */
const openOutside = (cwd: string, file: string) => Effect.flatMap(DesktopApi, (desktop) => desktop['Files.openExternal']({ cwd, file }));

/** The height of a line of the text, in px (`.code` in the styles). Lines never wrap, so each is this high. */
const LINE_HEIGHT = 18;
/** The height of the Line selection's popover and its gap to the lines, in px (`.line-actions` in the styles). */
const POPOVER_HEIGHT = 32;
const POPOVER_GAP = 4;

/** Where the marks of a Line selection go, in px from the top of the first line. */
interface LineMarks {
  readonly top: number;
  readonly height: number;
  readonly popoverTop: number;
  readonly above: boolean;
  readonly range: string;
}

/** The line (1-based) of the `.line` an event happened in, if any. */
const lineOf = (event: Event): number | undefined => {
  const line = event.target instanceof Element ? event.target.closest<HTMLElement>('.line') : null;
  const number = Number(line?.dataset['line']);
  return Number.isInteger(number) && number > 0 ? number : undefined;
};

/** `2.5 MB`: the size of a file too large to preview. */
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/** What the gutter shows for a line of a Changed file. */
export type GutterKind = 'added' | 'modified' | 'deleted';

/**
 * The gutter marks for each line of the file, derived from the diff's hunks. A wholly untracked file has no marks, since
 * its `U` already says it. Lines never wrap, so one element per line stays aligned with the highlighted text.
 */
const guttersOf = (diff: DiffState, lineCount: number): ReadonlyArray<GutterKind | undefined> => {
  if (diff.status !== 'changes' || diff.untracked || lineCount === 0) return Array(lineCount).fill(undefined);
  const marks: Array<GutterKind | undefined> = Array(lineCount).fill(undefined);
  for (const hunk of diff.hunks) {
    let now = hunk.newStart;
    let index = 0;
    while (index < hunk.lines.length) {
      const line = hunk.lines[index];
      if (line === undefined) break;
      if (line.kind === 'context') {
        now++;
        index++;
        continue;
      }
      if (line.kind === 'added') {
        // A modification is a removed line followed immediately by added lines, with no context between.
        const modified = index > 0 && hunk.lines[index - 1].kind === 'removed';
        marks[now - 1] = modified ? 'modified' : 'added';
        now++;
        index++;
        continue;
      }
      // A run of removed lines: decide whether it is a deletion (notch) or part of a modification.
      const removedStart = index;
      while (index < hunk.lines.length && hunk.lines[index].kind === 'removed') index++;
      const followedByAdded = index < hunk.lines.length && hunk.lines[index].kind === 'added';
      if (!followedByAdded && now <= lineCount) {
        // A pure deletion: one notch at the line where the deleted content would have been.
        marks[now - 1] = 'deleted';
      }
      // If followed by added lines, the added loop above will mark them as modified; no notch here.
      if (!followedByAdded) {
        // Keep `now` where it is: removed lines do not exist in the new file.
      }
    }
  }
  return marks;
};

/**
 * The body of a File View (GLOSSARY: File View, ADR 0013): one file of the Project, read-only, one element per line
 * with its number, highlighted by language (`file-language.ts`) once the worker colours it, under a Breadcrumb (in a
 * Tab; the Quick look's header has the path) and above a status bar; or the state that says why it is not shown
 * (binary, too large, gone, unreadable). It reads the file when it opens and when its path changes (a preview replaced).
 * A file picked in the tree gives it the keyboard (`TabsState.focusRequest`), so the user can scroll at once. Its header
 * is the Pane's (`PaneStack`), whose file actions (Copiar, Copiar ruta, open outside) call this View.
 *
 * In a Tab, the File View also reads the file's change against HEAD and offers Archivo/Cambios, sharing `app-file-diff`
 * with the Quick look. In Archivo, a gutter bar marks added or modified lines and a notch marks where lines were deleted.
 * The diff refreshes on the same triggers as the Files browser markers: a Provider Hook of any Terminal of the Project,
 * and window focus, debounced and one at a time.
 *
 * In a Tab, the Line selection (GLOSSARY) is marked from the line numbers and kept in `LineSelections`, not in the lines:
 * the tint and the popover are one layer over the text, placed by line height, so how the lines are drawn can change.
 */
@Component({
  selector: 'app-file-view',
  imports: [FileDiffView, MentionButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './file-view.html',
  styleUrl: './file-view.css',
  host: { '(document:mouseup)': 'endDrag()' },
})
export class FileView {
  protected readonly i18n = inject(I18n);
  private readonly runtime = inject(EffectRuntime);
  private readonly tabs = inject(TabsState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly highlighter = inject(SYNTAX_HIGHLIGHTER);
  private readonly outliner = inject(SYMBOL_OUTLINER);
  private readonly selections = inject(LineSelections);
  private readonly debounce = inject(DIFF_REFRESH_DEBOUNCE_MS);
  private readonly source = inject(ChangesRefreshSource);

  /** The Project's folder, which the path is relative to. */
  readonly cwd = input.required<string>();
  readonly path = input.required<string>();
  /** The Tab it is in, to tell a request for the keyboard meant for it. None outside a Tab (the Quick look). */
  readonly tabId = input<TabId>();
  /** The Project the file belongs to; without it the diff never refreshes on Hook/focus. */
  readonly projectId = input<ProjectId>();

  protected readonly file = signal<FileState>({ status: 'loading' });
  protected readonly name = computed(() => this.path().split('/').at(-1) ?? this.path());

  /** Archivo (the file) or Cambios (its diff). Only offered in a Tab. */
  protected readonly mode = signal<'file' | 'changes'>('file');
  /** The diff of the file, read when it opens and on refresh triggers. */
  protected readonly diff = signal<DiffState>({ status: 'loading' });
  /** Cambios is offered only for a Changed file with text: a diff with lines to show. */
  protected readonly canDiff = computed(() => this.diff().status === 'changes');
  /** Cambios keeps its place with another label when it is not offered, so the header does not shift. */
  protected readonly changesLabel = computed(() => {
    const status = this.diff().status;
    return this.i18n.t(status === 'changes' || status === 'loading' ? 'quickLook.changes' : 'quickLook.noChanges');
  });
  /** Whether this View is inside a Tab (not the Quick look) and can offer Cambios. */
  protected readonly inTab = computed(() => this.tabId() !== undefined);

  /** The text of the file, empty while it is not text. */
  private readonly content = computed(() => {
    const file = this.file();
    return file.status === 'text' ? file.content : '';
  });
  protected readonly lines = computed(() => linesOf(this.content()));
  /** The colours of the lines, none until the worker gives them (and never for plain text or a large file). */
  private readonly colours = signal<ReadonlyArray<ColourRange>>([]);
  /** Each line as the runs to draw. */
  protected readonly rows = computed(() => lineRuns(this.lines(), this.colours()));
  /** The gutter mark for each line, derived from the diff. */
  protected readonly gutters = computed(() => guttersOf(this.diff(), this.lines().length));
  /** The width the longest line needs, in characters: a line out of view is not laid out, so the text cannot measure it. */
  protected readonly columns = computed(() => columnsOf(this.lines()));
  /** How many digits the last line number has, which is the width of the numbers. */
  protected readonly digits = computed(() => String(this.lines().length).length);
  protected readonly language = computed(() => languageOf(this.name()));
  /** The Line selection as this file can hold it; none outside a Tab (the Quick look) or while the file is not text. */
  readonly selection = computed((): LineSelection | undefined => {
    const tab = this.tabId();
    return tab === undefined ? undefined : clampLines(this.selections.of(tab, this.path()), this.lines().length);
  });
  /**
   * Whether this View is forced to Fuente because it opened from a Path link with a line. #208 will combine this with the
   * global Renderizado/Fuente setting; until then the File View is always source, so this only carries the intent forward.
   */
  protected readonly sourceMode = signal(false);

  /** Whether there is text to copy: the header's Copiar is off for a file that is not shown. */
  readonly hasText = computed(() => this.lines().length > 0);

  /** What the user sees of the text: how far it is scrolled and how tall the Pane is, to place the popover. */
  private readonly viewport = signal({ top: 0, height: 0 });

  protected readonly marks = computed((): LineMarks | undefined => {
    const selection = this.selection();
    if (selection === undefined) return undefined;
    const { top, height } = this.viewport();
    const below = selection.end * LINE_HEIGHT + POPOVER_GAP;
    const over = (selection.start - 1) * LINE_HEIGHT - POPOVER_GAP - POPOVER_HEIGHT;
    // Near the Pane's bottom there is no room under the lines, unless above them it would be out of sight; a height not
    // known yet (0) never flips it.
    const above = height > 0 && below + POPOVER_HEIGHT > top + height && over >= top;
    return {
      top: (selection.start - 1) * LINE_HEIGHT,
      height: (selection.end - selection.start + 1) * LINE_HEIGHT,
      popoverTop: above ? over : below,
      above,
      range: lineRange(selection),
    };
  });

  /** The line a drag down the numbers started on; `clears` while a click on the only selected line may still clear it. */
  private drag: { readonly anchor: number; readonly clears: boolean } | undefined;

  /** The symbols of each line, once Lezer has outlined the text; never for a file with no outline or a large one. */
  private readonly outline = signal<Outline | undefined>(undefined);
  /**
   * The Breadcrumb (GLOSSARY): the folders, the file's name, then the declarations that hold the Line selection's start
   * (line 1 with none). The file's name and the innermost symbol are strong.
   */
  protected readonly breadcrumb = computed(() => {
    const folders = this.path().split('/');
    const name = folders.pop() ?? '';
    const symbols = this.outline()?.(this.selection()?.start ?? 1) ?? [];
    return [
      ...folders.map((text) => ({ text, strong: false })),
      { text: name, strong: true },
      ...symbols.map((text, index) => ({ text, strong: index === symbols.length - 1 })),
    ];
  });

  /** The status bar: lines, language, line endings, indent guess and a fixed encoding. */
  protected readonly status = computed(() => {
    const selection = this.selection();
    const span = selection === undefined ? '' : selection.start === selection.end ? `${selection.start}` : `${selection.start}–${selection.end}`;
    const lines = selection === undefined ? this.i18n.t('fileView.noLines') : this.i18n.t('fileView.lines', { lines: span, total: this.lines().length });
    const language = this.language();
    const eol = eolOf(this.content());
    const indent = indentOf(this.lines());
    return [
      lines,
      language === PLAIN_TEXT ? this.i18n.t('fileView.plainText') : language.name,
      ...(eol === undefined ? [] : [eol === 'Mixed' ? this.i18n.t('fileView.mixedEol') : eol]),
      ...(indent === undefined ? [] : [indent.kind === 'tabs' ? this.i18n.t('fileView.tabs') : this.i18n.t('fileView.spaces', { size: indent.size })]),
      'UTF-8',
    ];
  });

  /** The wait for a burst of diff refresh triggers to end, and whether a diff read is running or must run again after it. */
  private diffTimer: ReturnType<typeof setTimeout> | undefined;
  private diffRunning = false;
  private diffAgain = false;

  constructor() {
    effect(() => {
      const cwd = this.cwd();
      const path = this.path();
      untracked(() => {
        void this.read(cwd, path);
        if (this.inTab()) {
          this.mode.set('file');
          this.diff.set({ status: 'loading' });
          this.clearDiffRefresh();
          void this.runDiffRefresh(cwd, path, true);
        }
      });
    });
    effect(() => {
      const pulse = this.source.trigger();
      const projectId = this.projectId();
      if (projectId === undefined || pulse === undefined || pulse.projectId !== projectId) return;
      untracked(() => this.scheduleDiffRefresh());
    });
    effect(() => {
      const request = this.tabs.focusRequest();
      if (request === undefined || request.tab !== this.tabId() || fileOf(request.view) !== this.path()) return;
      untracked(() => {
        this.tabs.focusRequest.set(undefined);
        afterNextRender(() => this.scroller()?.focus(), { injector: this.injector });
      });
    });
    // A selection set from elsewhere is placed against what is on screen now.
    effect(() => {
      if (this.selection() !== undefined) untracked(() => this.measure());
    });
    // A jump to lines of this file (a Path link) scrolls them to the middle once the text is there; one past the end
    // opens at the top. A Markdown file opened with a line keeps Fuente for this View.
    effect(() => {
      const request = this.selections.revealed();
      const tab = this.tabId();
      if (request === undefined || tab === undefined || request.tab !== tab || request.path !== this.path() || this.file().status !== 'text') return;
      const count = this.lines().length;
      untracked(() => {
        this.selections.revealed.set(undefined);
        if (request.source === true) this.sourceMode.set(true);
        afterNextRender(() => this.scrollToLines(request.start, request.end, count), { injector: this.injector });
      });
    });
  }

  /** Scrolls lines `start` to `end` to the middle of the View; to the top when they are past the last line. */
  private scrollToLines(start: number, end: number, count: number): void {
    const scroller = this.scroller();
    if (scroller === null) return;
    const middle = ((start - 1 + Math.min(end, count)) / 2) * LINE_HEIGHT;
    scroller.scrollTop = start > count ? 0 : Math.max(0, middle - scroller.clientHeight / 2);
    this.measure();
  }

  private scroller(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('.scroll');
  }

  protected size(bytes: number): string {
    return formatSize(bytes);
  }

  private async read(cwd: string, path: string): Promise<void> {
    this.file.set({ status: 'loading' });
    const exit = await this.runtime.run(readFile(cwd, path));
    // Another file took this View's place while this one was read.
    if (path !== this.path() || cwd !== this.cwd()) return;
    const file: FileState = Exit.isSuccess(exit) ? exit.value : { status: 'failed', detail: Cause.pretty(exit.cause) };
    this.colours.set([]);
    this.outline.set(undefined);
    this.file.set(file);
    if (file.status !== 'text') return;
    void this.colour(cwd, path, file.content);
    void this.outlineText(cwd, path, file.content);
  }

  /** Has Lezer outline a text whose language has symbols and that is not too large; only the path shows meanwhile. */
  private async outlineText(cwd: string, path: string, content: string): Promise<void> {
    const { symbols } = this.language();
    if (symbols === undefined || content.length > MAX_COLOURED_LENGTH) return;
    const exit = await this.runtime.run(this.outliner.outline(content, symbols));
    if (path !== this.path() || cwd !== this.cwd() || this.content() !== content) return;
    if (Exit.isSuccess(exit)) this.outline.set(exit.value);
  }

  /** Asks the worker for the colours of a text that has a language and is not too large; the plain text shows meanwhile. */
  private async colour(cwd: string, path: string, content: string): Promise<void> {
    const { hljsId } = this.language();
    if (hljsId === undefined || content.length > MAX_COLOURED_LENGTH) return;
    const exit = await this.runtime.run(this.highlighter.colours(content, hljsId));
    // Another file, or another read of this one, took its place meanwhile.
    if (path !== this.path() || cwd !== this.cwd() || this.content() !== content) return;
    if (Exit.isSuccess(exit)) this.colours.set(exit.value);
  }

  // ---- Archivo / Cambios -------------------------------------------------------------------------------------------

  /** Switches between Archivo and Cambios. Cambios only when there is a diff to show. */
  protected show(mode: 'file' | 'changes'): void {
    if (mode === 'changes' && !this.canDiff()) return;
    this.mode.set(mode);
  }

  private clearDiffRefresh(): void {
    clearTimeout(this.diffTimer);
    this.diffTimer = undefined;
  }

  private scheduleDiffRefresh(): void {
    if (this.projectId() === undefined) return;
    this.clearDiffRefresh();
    this.diffTimer = setTimeout(() => {
      this.diffTimer = undefined;
      void this.runDiffRefresh(this.cwd(), this.path(), false);
    }, this.debounce);
  }

  private async runDiffRefresh(cwd: string, path: string, showLoading: boolean): Promise<void> {
    if (this.diffRunning) {
      this.diffAgain = true;
      return;
    }
    this.diffRunning = true;
    await this.readDiff(cwd, path, showLoading);
    this.diffRunning = false;
    if (this.diffAgain) {
      this.diffAgain = false;
      this.scheduleDiffRefresh();
    }
  }

  private async readDiff(cwd: string, path: string, showLoading: boolean): Promise<void> {
    if (showLoading) this.diff.set({ status: 'loading' });
    const exit = await this.runtime.run(readDiff(cwd, path));
    // Another file took this View's place while this one was read.
    if (path !== this.path() || cwd !== this.cwd()) return;
    const diff: DiffState = Exit.isSuccess(exit) ? exit.value : { status: 'failed', detail: Cause.pretty(exit.cause) };
    this.diff.set(diff);
    if (diff.status !== 'changes') this.mode.set('file');
  }

  // ---- Line selection ----------------------------------------------------------------------------------------------

  private select(selection: LineSelection | undefined): void {
    const tab = this.tabId();
    if (tab !== undefined) this.selections.set(tab, this.path(), selection);
  }

  /** A press on a line number: selects it, or with shift extends from the anchor; a drag from here marks a range. */
  protected pressLine(event: MouseEvent): void {
    const line = lineOf(event);
    const onNumber = event.target instanceof Element && event.target.closest('.number') !== null;
    if (event.button !== 0 || this.tabId() === undefined || line === undefined || !onNumber) return;
    // The numbers mark lines, never the browser's text selection; the press still gives the View the keyboard (Esc).
    event.preventDefault();
    this.scroller()?.focus({ preventScroll: true });
    const current = this.selection();
    if (!event.shiftKey && isOnlyLine(current, line)) {
      this.drag = { anchor: line, clears: true };
      return;
    }
    const next = clickLine(current, line, event.shiftKey);
    this.drag = { anchor: next.anchor, clears: false };
    this.select(next);
    this.measure();
  }

  /** The pointer moves over the lines with the button down after a press on a number: the range follows it. */
  protected dragLine(event: MouseEvent): void {
    const drag = this.drag;
    if (drag === undefined) return;
    if (event.buttons === 0) return this.endDrag();
    const line = lineOf(event);
    if (line === undefined || (drag.clears && line === drag.anchor)) return;
    this.drag = { anchor: drag.anchor, clears: false };
    this.select(rangeFrom(drag.anchor, line));
    this.measure();
  }

  protected endDrag(): void {
    if (this.drag?.clears === true) this.clearSelection();
    this.drag = undefined;
  }

  protected clearSelection(): void {
    if (this.selection() !== undefined) this.select(undefined);
  }

  /** Reads how far the text is scrolled and how much of it shows: the popover flips above near the Pane's bottom. */
  protected measure(): void {
    const scroller = this.scroller();
    if (scroller === null) return;
    const next = { top: scroller.scrollTop, height: scroller.clientHeight };
    const current = this.viewport();
    if (current.top !== next.top || current.height !== next.height) this.viewport.set(next);
  }

  // ---- Actions of the popover and of the header ---------------------------------------------------------------------

  /** Copiar: the selected lines exactly, without their numbers; with no Line selection, the whole text that is shown. */
  copy(): void {
    if (!this.hasText()) return;
    const content = this.content();
    const selection = this.selection();
    this.toClipboard(selection === undefined ? content : selectedText(content, selection));
  }

  /** Copiar ruta: the path in the Project with `/`, plus `:n` or `:start-end` with a Line selection. */
  copyPath(): void {
    this.toClipboard(pathWithLines(this.path(), this.selection()));
  }

  /** Opens the file outside Timmy, in the app the system has for it. */
  openExternal(): void {
    void this.runtime.run(openOutside(this.cwd(), this.path()));
  }

  private toClipboard(text: string): void {
    void this.runtime.run(Effect.tryPromise(() => navigator.clipboard.writeText(text)));
  }
}
