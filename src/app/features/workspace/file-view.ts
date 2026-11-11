import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, InjectionToken, afterNextRender, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { DomSanitizer, type SafeHtml } from '@angular/platform-browser';
import { Cause, Effect, Exit } from 'effect';
import type { ImageType } from '../../../shared/files/files.model';
import type { ProjectId } from '../../../shared/projects/projects.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { FileDiffView, readDiff, type DiffState } from './file-diff';
import { formatSize } from './format-size';
import { FilePicture } from './file-picture';
import { FileVersions, sameVersion, type DiskVersion } from './file-versions';
import { readFile, readPicture, type FileState } from './file-read';
import { FilesBrowser } from './files-browser';
import { QuickLookState } from './quick-look-state';
import { ReaderMode } from './reader-mode';
import { ChangesRefreshSource } from './changes-refresh';
import type { TabId } from './tabs';
import { TabsState } from './tabs-state';
import { PLAIN_TEXT, languageOf } from './file-language';
import { LineSelections, clampLines, clickLine, isOnlyLine, lineRange, pathWithLines, rangeFrom, selectedText, type LineSelection } from './line-selection';
import { MentionButton } from './mention-button';
import { columnsOf, eolOf, indentOf, lineRuns, linesOf, type ColourRange } from './source-text';
import { SYMBOL_OUTLINER, type Outline } from './symbol-outline';
import { MAX_COLOURED_LENGTH, SYNTAX_HIGHLIGHTER } from './syntax-highlighter';
import type { RenderedMarkdown } from './markdown-render';
import { HEADING_ID_PREFIX } from './resolve-in-project';
import { fileOf } from './views';

/** How long a burst of diff refresh triggers must be over before the diff is read again, in milliseconds. */
export const DIFF_REFRESH_DEBOUNCE_MS = new InjectionToken<number>('DIFF_REFRESH_DEBOUNCE_MS', { providedIn: 'root', factory: () => 300 });

/** The kind of a picture, as the status bar names it. */
const IMAGE_KIND: Readonly<Record<ImageType, string>> = {
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
  'image/gif': 'GIF',
  'image/webp': 'WebP',
  'image/avif': 'AVIF',
  'image/x-icon': 'ICO',
  'image/bmp': 'BMP',
  'image/svg+xml': 'SVG',
};

/** Above this many characters a Markdown file is not rendered: the toggle is off and says so. About 512 KB. */
export const MAX_RENDERED_LENGTH = 512 * 1024;

type PixelSize = { readonly width: number; readonly height: number };
type ReaderModeChoice = ReturnType<ReaderMode['mode']>;

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
 * (binary, too large, gone, unreadable), each with its way out (open outside Timmy, Reintentar). An image shows as a
 * picture (`FilePicture`) with its size and weight in the status bar; an SVG is text, and a picture only in Imagen, the
 * reader's one Renderizado/Fuente choice (`ReaderMode`). A Markdown file has Fuente and Renderizado; `.mdx` is Fuente
 * only. It reads the file when it opens and when its path changes (a preview replaced). A file picked in the tree gives
 * it the keyboard (`TabsState.focusRequest`), so the user can scroll at once. Its header is the Pane's (`PaneStack`),
 * whose file actions (Copiar, Copiar ruta, open outside) call this View.
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
  imports: [FileDiffView, FilePicture, MentionButton],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './file-view.html',
  styleUrl: './file-view.css',
  host: { '(document:mouseup)': 'endDrag()', '(focusin)': 'versions.check()' },
})
export class FileView {
  protected readonly i18n = inject(I18n);
  private readonly runtime = inject(EffectRuntime);
  private readonly tabs = inject(TabsState);
  private readonly sanitizer = inject(DomSanitizer);
  private destroyed = false;
  private readonly browser = inject(FilesBrowser);
  private readonly quickLook = inject(QuickLookState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly highlighter = inject(SYNTAX_HIGHLIGHTER);
  private readonly outliner = inject(SYMBOL_OUTLINER);
  protected readonly reader = inject(ReaderMode);
  private readonly selections = inject(LineSelections);
  protected readonly versions = inject(FileVersions);
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

  /**
   * The version of the file the text on screen was read from (null: it was not there); none until the first read, and
   * always none outside a Tab, where there is no hint (the Quick look).
   */
  private readonly loaded = signal<DiskVersion | undefined>(undefined);
  /** Whether the file went missing after it was read: a path that comes back is then stale, even with the same version. */
  private readonly lost = signal(false);
  /** The file this View has begun to read. The header asks `freshness` before the inputs are set, which a signal of the inputs cannot answer. */
  private readonly target = signal<{ readonly cwd: string; readonly path: string } | undefined>(undefined);
  /**
   * Stale File View (GLOSSARY): `stale` when the file on disk is not the one on screen, `gone` when it is deleted or renamed
   * (its last text stays, dimmed), else `current`. A View opened on a path that was never there shows its empty state only.
   */
  readonly freshness = computed((): 'current' | 'stale' | 'gone' => {
    const target = this.target();
    const loaded = this.loaded();
    const latest = target === undefined ? undefined : this.versions.latest(target.cwd, target.path);
    if (loaded === undefined || latest === undefined || this.file().status === 'loading') return 'current';
    if (latest === null) return loaded === null ? 'current' : 'gone';
    return loaded === null || this.lost() || !sameVersion(loaded, latest) ? 'stale' : 'current';
  });
  /** Why Mencionar of the Line selection is off: it would name lines of a file that is not the one on screen. */
  protected readonly mentionBlock = computed((): string | undefined => {
    const freshness = this.freshness();
    return freshness === 'stale' ? this.i18n.t('fileView.reloadFirst') : freshness === 'gone' ? this.i18n.t('fileView.goneBar') : undefined;
  });
  /** Why Mencionar of the whole file is off: only a file that no longer exists cannot be named. */
  readonly fileMentionBlock = computed((): string | undefined => (this.freshness() === 'gone' ? this.i18n.t('fileView.goneBar') : undefined));
  /** Why Copiar ruta with a range is off while stale. The path alone, and copying selected text, are never blocked. */
  readonly rangeBlock = computed((): string | undefined => (this.freshness() === 'stale' && this.selection() !== undefined ? this.i18n.t('fileView.reloadFirst') : undefined));
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

  /** An SVG has two forms, its text (Fuente) and its picture (Imagen); Markdown has Fuente and Renderizado. */
  protected readonly isSvg = computed(() => this.language().name === 'SVG' && this.file().status === 'text');
  /** Markdown has a rendered form; `.mdx` is JSX in disguise and stays Fuente, highlighted as Markdown. */
  protected readonly isMarkdown = computed(() => this.language().name === 'Markdown' && this.file().status === 'text' && !this.name().toLowerCase().endsWith('.mdx'));
  /** Forced to Fuente by a Path link with a line, or by the global choice otherwise. */
  protected readonly forcedSource = signal(false);
  /** The effective mode for this View: forced source wins over the global setting. */
  protected readonly effectiveMode = computed((): ReaderModeChoice => (this.forcedSource() ? 'source' : this.reader.mode()));
  /** Whether the rendered form (SVG picture or Markdown page) is on screen. */
  protected readonly drawn = computed(() => (this.isSvg() || this.isMarkdown()) && this.effectiveMode() === 'rendered');
  /** The SVG's picture, read when Imagen is first chosen for it; none until then. */
  protected readonly svgPicture = signal<FileState | undefined>(undefined);
  /** What the body shows: the file, or the SVG's picture in Imagen. */
  protected readonly shown = computed((): FileState => (this.isSvg() && this.drawn() && this.mode() === 'file' ? (this.svgPicture() ?? { status: 'loading' }) : this.file()));
  /** A picture at its natural size (scrolling) rather than fitted. */
  protected readonly actual = signal(false);
  /** The size an SVG drew at, which only drawing it tells. */
  private readonly drawnSize = signal<PixelSize | undefined>(undefined);

  /** Rendered Markdown state. */
  protected readonly markdown = signal<RenderedMarkdown | undefined>(undefined);
  /** The sanitised page, which the renderer already made safe; Angular would drop the `data-timmy-*` marks it carries. */
  protected readonly page = computed((): SafeHtml => this.sanitizer.bypassSecurityTrustHtml(this.markdown()?.html ?? ''));
  /** Whether the Markdown file is too large to render. */
  protected readonly markdownTooLarge = computed(() => this.isMarkdown() && this.content().length > MAX_RENDERED_LENGTH);
  /** Whether the rendered Markdown body is on screen right now. */
  protected readonly rendered = computed(() => this.isMarkdown() && this.drawn() && !this.markdownTooLarge() && this.markdown() !== undefined);

  /** What a state the reader cannot help with says, and whether reading again may help; the way out is always offered. */
  protected readonly stuck = computed((): { readonly note: string; readonly retry: boolean } => {
    const state = this.shown();
    switch (state.status) {
      case 'binary':
        return { note: this.i18n.t('reader.binary', { size: formatSize(state.size) }), retry: false };
      case 'tooLarge':
        return { note: this.i18n.t('files.tooLarge', { size: formatSize(state.size) }), retry: false };
      case 'imageTooLarge':
        return state.limit === 'bytes'
          ? { note: this.i18n.t('reader.imageOverBytes', { size: formatSize(state.size) }), retry: false }
          : { note: this.i18n.t('reader.imageOverPixels', { width: state.width, height: state.height }), retry: false };
      case 'unreadable':
        return { note: this.i18n.t('files.unreadable'), retry: true };
      case 'failed':
        return { note: this.i18n.t('files.fileFailed', { detail: state.detail }), retry: true };
      default:
        return { note: '', retry: false };
    }
  });

  /** The status bar of a picture: its size in pixels once known, its weight and its kind. */
  protected readonly pictureStatus = computed(() => {
    const shown = this.shown();
    if (shown.status !== 'image') return [];
    const { picture } = shown;
    const size = picture.width !== null && picture.height !== null ? { width: picture.width, height: picture.height } : this.drawnSize();
    return [...(size === undefined ? [] : [`${size.width} × ${size.height}`]), formatSize(picture.size), IMAGE_KIND[picture.type]];
  });

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
    // The Line selection lives in Fuente only; it is kept while Renderizado shows, and is there again after.
    return tab === undefined || this.rendered() ? undefined : clampLines(this.selections.of(tab, this.path()), this.lines().length);
  });

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
    inject(DestroyRef).onDestroy(() => (this.destroyed = true));
    effect(() => {
      const cwd = this.cwd();
      const path = this.path();
      untracked(() => {
        this.target.set({ cwd, path });
        void this.read(cwd, path);
        if (this.inTab()) {
          this.mode.set('file');
          this.diff.set({ status: 'loading' });
          this.clearDiffRefresh();
          void this.runDiffRefresh(cwd, path, true);
        }
      });
    });
    // The open File Views of a Project are checked together (`FileVersions`); a Quick look is not one of them.
    effect((onCleanup) => {
      if (this.tabId() === undefined) return;
      onCleanup(this.versions.watch(this.cwd(), this.path()));
    });
    effect(() => {
      if (this.versions.latest(this.cwd(), this.path()) === null && this.loaded() !== null) untracked(() => this.lost.set(true));
    });
    effect(() => {
      const pulse = this.source.trigger();
      const projectId = this.projectId();
      if (projectId === undefined || pulse === undefined || pulse.projectId !== projectId) return;
      untracked(() => this.scheduleDiffRefresh());
    });
    effect(() => {
      // Imagen chosen for an SVG whose picture is not read yet, here or in another View.
      if (!this.isSvg() || !this.drawn() || this.svgPicture() !== undefined) return;
      untracked(() => void this.readSvgPicture(this.cwd(), this.path()));
    });
    effect(() => {
      // Renderizado chosen for a Markdown file that has not been rendered yet.
      if (!this.isMarkdown() || !this.drawn() || this.markdownTooLarge() || this.markdown() !== undefined) return;
      untracked(() => void this.render(this.path(), this.content()));
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
        if (request.source === true) this.forcedSource.set(true);
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

  /** Shows every SVG/Markdown this way, in every View, from now on. */
  protected choose(mode: ReaderModeChoice): void {
    this.forcedSource.set(false);
    this.reader.set(mode);
  }

  protected retry(): void {
    void this.read(this.cwd(), this.path());
  }

  /**
   * Recargar: reads the file again where it is, keeping the text on screen until the new one arrives, so the scroll and the
   * Line selection (kept by line number, clamped to the new length) stay. It is the one reload rule of a File View: whatever
   * else is derived from the file (the diff, the gutter bars) is read in `read`, so it is re-run together with the text.
   */
  protected reload(): void {
    void this.read(this.cwd(), this.path(), true);
  }

  /** `1` toggles a picture between fitted and actual size. */
  protected keydown(event: KeyboardEvent): void {
    if (event.key !== '1' || event.ctrlKey || event.metaKey || event.altKey || this.shown().status !== 'image') return;
    event.preventDefault();
    this.actual.update((actual) => !actual);
  }

  protected pictureDrawn(size: PixelSize): void {
    this.drawnSize.set(size);
  }

  private async readSvgPicture(cwd: string, path: string): Promise<void> {
    this.svgPicture.set({ status: 'loading' });
    const exit = await this.runtime.run(readPicture(cwd, path, () => ({ status: 'notAnImage' })));
    if (path !== this.path() || cwd !== this.cwd()) return;
    this.svgPicture.set(Exit.isSuccess(exit) ? exit.value : { status: 'failed', detail: Cause.pretty(exit.cause) });
  }

  private async render(path: string, content: string): Promise<void> {
    this.markdown.set(undefined);
    const cwd = this.cwd();
    const { renderMarkdown } = await import('./markdown-render');
    const rendered = await renderMarkdown({ content, path, inertTitle: this.i18n.t('markdown.inert'), kindOf: (target) => this.kindOf(cwd, target) });
    if (path !== this.path() || cwd !== this.cwd() || content !== this.content()) return;
    this.markdown.set(rendered);
    if (!this.destroyed) afterNextRender(() => void this.loadRenderedImages(), { injector: this.injector });
  }

  private async read(cwd: string, path: string, reload = false): Promise<void> {
    if (!reload) this.file.set({ status: 'loading' });
    this.svgPicture.set(undefined);
    this.markdown.set(undefined);
    this.drawnSize.set(undefined);
    // The version is asked before the content: a change that lands while it is read leaves the View stale, never wrongly current.
    const version = this.tabId() === undefined ? undefined : await this.versions.baseline(cwd, path);
    this.forcedSource.set(false);
    const exit = await this.runtime.run(readFile(cwd, path));
    // Another file took this View's place while this one was read.
    if (path !== this.path() || cwd !== this.cwd()) return;
    const file: FileState = Exit.isSuccess(exit) ? exit.value : { status: 'failed', detail: Cause.pretty(exit.cause) };
    // A file deleted while it was reloaded keeps its last text and its version, dimmed under the gone bar.
    if (reload && file.status === 'gone' && this.file().status !== 'gone') return;
    this.loaded.set(version);
    this.lost.set(false);
    this.colours.set([]);
    this.outline.set(undefined);
    this.file.set(file);
    if (file.status === 'text') {
      void this.colour(cwd, path, file.content);
      void this.outlineText(cwd, path, file.content);
    }
    if (this.isSvg() || this.isMarkdown()) this.reader.load();
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

  // ---- Rendered Markdown interactions -------------------------------------------------------------------------------

  /** What a path of the Project is on disk, by the listing of its folder; nothing when it is not there. */
  private async kindOf(cwd: string, target: string): Promise<'file' | 'folder' | undefined> {
    const slash = target.lastIndexOf('/');
    const dir = slash === -1 ? '' : target.slice(0, slash);
    const name = target.slice(slash + 1);
    const exit = await this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Files.listDir']({ cwd, dir })));
    return Exit.isSuccess(exit) ? exit.value.entries.find((entry) => entry.name === name)?.kind : undefined;
  }

  /** Loads every relative image of the rendered page through Files.readImage into a blob URL. */
  private async loadRenderedImages(): Promise<void> {
    const cwd = this.cwd();
    const images = Array.from(this.markdownContainer()?.querySelectorAll<HTMLImageElement>('img[data-timmy-image]') ?? []);
    await Promise.all(
      images.map(async (img) => {
        const file = img.dataset['timmyImage'] ?? '';
        const exit = await this.runtime.run(readPicture(cwd, file, (size) => ({ status: 'binary', size })));
        if (!Exit.isSuccess(exit) || exit.value.status !== 'image' || !img.isConnected) return;
        const { picture } = exit.value;
        const url = URL.createObjectURL(new Blob([picture.bytes as Uint8Array<ArrayBuffer>], { type: picture.type }));
        img.addEventListener('load', () => URL.revokeObjectURL(url), { once: true });
        img.src = url;
      }),
    );
  }

  private markdownContainer(): HTMLElement | null {
    return this.host.nativeElement.querySelector<HTMLElement>('.markdown-body');
  }

  /**
   * Every click in rendered Markdown stops here, so the window never navigates. A link to a Project file opens a preview
   * File View (in the Quick look, closing it first), a folder is revealed in the tree, a `#anchor` scrolls inside the
   * document, an `https:` link opens in the external browser; anything else had no destination to begin with.
   */
  protected markdownClick(event: MouseEvent): void {
    event.preventDefault();
    const link = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-timmy-link]') : null;
    const target = link?.dataset['timmyTarget'];
    if (link === null || target === undefined) return;
    switch (link.dataset['timmyLink']) {
      case 'file':
        if (this.tabId() === undefined) this.quickLook.close();
        this.browser.openFile(target);
        break;
      case 'folder':
        this.browser.reveal(target);
        break;
      case 'anchor':
        this.markdownContainer()
          ?.querySelector<HTMLElement>(`[id="${CSS.escape(HEADING_ID_PREFIX + target)}"], [id="${CSS.escape(target)}"]`)
          ?.scrollIntoView({ behavior: 'instant' });
        break;
      case 'external':
        window.open(target, '_blank');
        break;
    }
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
    if (this.rendered()) {
      this.toClipboard(this.path());
      return;
    }
    if (!this.hasText()) return;
    const content = this.content();
    const selection = this.selection();
    this.toClipboard(selection === undefined ? content : selectedText(content, selection));
  }

  /** Copiar ruta: the path in the Project with `/`, plus `:n` or `:start-end` with a Line selection. */
  copyPath(): void {
    this.toClipboard(pathWithLines(this.path(), this.selection()));
  }

  /** Opens the file outside Timmy, in the app the system has for it: also the way out of every state the reader cannot help with. */
  openExternal(): void {
    void this.runtime.run(openOutside(this.cwd(), this.path()));
  }

  private toClipboard(text: string): void {
    void this.runtime.run(Effect.tryPromise(() => navigator.clipboard.writeText(text)));
  }
}
