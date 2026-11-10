import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, Injector } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { LineSelections, clampLines, clickLine, isOnlyLine, lineRange, pathWithLines, rangeFrom, selectedText, type LineSelection } from './line-selection';
import type { TabId } from './tabs';
import { TabsState } from './tabs-state';
import { PLAIN_TEXT, languageOf } from './file-language';
import { columnsOf, eolOf, indentOf, lineRuns, linesOf, type ColourRange } from './source-text';
import { MAX_COLOURED_LENGTH, SYNTAX_HIGHLIGHTER } from './syntax-highlighter';
import { fileOf } from './views';

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

/**
 * The body of a File View (GLOSSARY: File View, ADR 0013): one file of the Project, read-only, one element per line
 * with its number, highlighted by language (`file-language.ts`) once the worker colours it, above a status bar; or the
 * state that says why it is not shown (binary, too large, gone, unreadable). It reads the file when it opens and when its path changes (a preview replaced). A file picked in the tree gives it the keyboard
 * (`TabsState.focusRequest`), so the user can scroll at once. Its header is the Pane's (`PaneStack`), whose file actions
 * (Copiar, Copiar ruta, open outside) call this View.
 *
 * In a Tab, the Line selection (GLOSSARY) is marked from the line numbers and kept in `LineSelections`, not in the lines:
 * the tint and the popover are one layer over the text, placed by line height, so how the lines are drawn can change.
 */
@Component({
  selector: 'app-file-view',
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
  private readonly selections = inject(LineSelections);

  /** The Project's folder, which the path is relative to. */
  readonly cwd = input.required<string>();
  readonly path = input.required<string>();
  /** The Tab it is in, to tell a request for the keyboard meant for it. None outside a Tab (the Quick look). */
  readonly tabId = input<TabId>();

  protected readonly file = signal<FileState>({ status: 'loading' });
  protected readonly name = computed(() => this.path().split('/').at(-1) ?? this.path());

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

  constructor() {
    effect(() => {
      const cwd = this.cwd();
      const path = this.path();
      untracked(() => void this.read(cwd, path));
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
    this.file.set(file);
    if (file.status === 'text') void this.colour(cwd, path, file.content);
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
