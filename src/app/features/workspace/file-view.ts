import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, input, signal, untracked, Injector } from '@angular/core';
import { Cause, Effect, Exit } from 'effect';
import type { ImageType } from '../../../shared/files/files.model';
import { DesktopApi } from '../../core/desktop-api';
import { EffectRuntime } from '../../core/effect-runtime';
import { I18n } from '../../core/i18n';
import { FilePicture } from './file-picture';
import { readFile, readPicture, type FileState } from './file-read';
import { ReaderMode } from './reader-mode';
import type { TabId } from './tabs';
import { TabsState } from './tabs-state';
import { PLAIN_TEXT, languageOf } from './file-language';
import { columnsOf, eolOf, indentOf, lineRuns, linesOf, type ColourRange, type LineRange } from './source-text';
import { MAX_COLOURED_LENGTH, SYNTAX_HIGHLIGHTER } from './syntax-highlighter';
import { fileOf } from './views';

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

type PixelSize = { readonly width: number; readonly height: number };
type ReaderModeChoice = ReturnType<ReaderMode['mode']>;

/** `2.5 MB`: the size of a file too large to preview. */
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * The body of a File View (GLOSSARY: File View, ADR 0013): one file of the Project, read-only, one element per line
 * with its number, highlighted by language (`file-language.ts`) once the worker colours it, above a status bar; or the
 * state that says why it is not shown (binary, too large, gone, unreadable), each with its way out (open outside Timmy,
 * Reintentar). An image shows as a picture (`FilePicture`) with its size and weight in the status bar; an SVG is text,
 * and a picture only in Imagen, the reader's one Renderizado/Fuente choice (`ReaderMode`). It reads the file when it opens and when its path changes (a preview replaced). A file picked in the tree gives it the keyboard
 * (`TabsState.focusRequest`), so the user can scroll at once. Its header is the Pane's (`PaneStack`).
 */
@Component({
  selector: 'app-file-view',
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './file-view.html',
  styleUrl: './file-view.css',
  imports: [FilePicture],
})
export class FileView {
  protected readonly i18n = inject(I18n);
  private readonly runtime = inject(EffectRuntime);
  private readonly tabs = inject(TabsState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly highlighter = inject(SYNTAX_HIGHLIGHTER);
  protected readonly reader = inject(ReaderMode);

  /** The Project's folder, which the path is relative to. */
  readonly cwd = input.required<string>();
  readonly path = input.required<string>();
  /** The Tab it is in, to tell a request for the keyboard meant for it. None outside a Tab (the Quick look). */
  readonly tabId = input<TabId>();

  protected readonly file = signal<FileState>({ status: 'loading' });
  protected readonly name = computed(() => this.path().split('/').at(-1) ?? this.path());

  /** An SVG has two forms, its text (Fuente) and its picture (Imagen); every other file has one. */
  protected readonly isSvg = computed(() => this.language().name === 'SVG' && this.file().status === 'text');
  /** Whether an SVG shows as its picture: the reader's global choice. */
  protected readonly drawn = computed(() => this.isSvg() && this.reader.mode() === 'rendered');
  /** The SVG's picture, read when Imagen is first chosen for it; none until then. */
  protected readonly svgPicture = signal<FileState | undefined>(undefined);
  /** What the body shows: the file, or the SVG's picture in Imagen. */
  protected readonly shown = computed((): FileState => (this.drawn() ? (this.svgPicture() ?? { status: 'loading' }) : this.file()));
  /** A picture at its natural size (scrolling) rather than fitted. */
  protected readonly actual = signal(false);
  /** The size an SVG drew at, which only drawing it tells. */
  private readonly drawnSize = signal<PixelSize | undefined>(undefined);

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
  /** The width the longest line needs, in characters: a line out of view is not laid out, so the text cannot measure it. */
  protected readonly columns = computed(() => columnsOf(this.lines()));
  /** How many digits the last line number has, which is the width of the numbers. */
  protected readonly digits = computed(() => String(this.lines().length).length);
  protected readonly language = computed(() => languageOf(this.name()));
  /** The Line selection; none yet. */
  protected readonly selection = signal<LineRange | undefined>(undefined);

  /** The status bar: lines, language, line endings, indent guess and a fixed encoding. */
  protected readonly status = computed(() => {
    const selection = this.selection();
    const span = selection === undefined ? '' : selection.from === selection.to ? `${selection.from}` : `${selection.from}–${selection.to}`;
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
      // Imagen chosen for an SVG whose picture is not read yet, here or in another View.
      if (!this.drawn() || this.svgPicture() !== undefined) return;
      untracked(() => void this.readSvgPicture(this.cwd(), this.path()));
    });
    effect(() => {
      const request = this.tabs.focusRequest();
      if (request === undefined || request.tab !== this.tabId() || fileOf(request.view) !== this.path()) return;
      untracked(() => {
        this.tabs.focusRequest.set(undefined);
        afterNextRender(() => this.host.nativeElement.querySelector<HTMLElement>('.scroll')?.focus(), { injector: this.injector });
      });
    });
  }

  /** Shows every SVG (and Markdown) this way, in every View, from now on. */
  protected choose(mode: ReaderModeChoice): void {
    this.reader.set(mode);
  }

  /** Opens the file with the system's app for it: the way out of every state the reader cannot help with. */
  protected openOutside(): void {
    void this.runtime.run(Effect.flatMap(DesktopApi, (desktop) => desktop['Files.openExternal']({ cwd: this.cwd(), file: this.path() })));
  }

  protected retry(): void {
    void this.read(this.cwd(), this.path());
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

  private async read(cwd: string, path: string): Promise<void> {
    this.file.set({ status: 'loading' });
    this.svgPicture.set(undefined);
    this.drawnSize.set(undefined);
    const exit = await this.runtime.run(readFile(cwd, path));
    // Another file took this View's place while this one was read.
    if (path !== this.path() || cwd !== this.cwd()) return;
    const file: FileState = Exit.isSuccess(exit) ? exit.value : { status: 'failed', detail: Cause.pretty(exit.cause) };
    this.colours.set([]);
    this.file.set(file);
    if (file.status === 'text') void this.colour(cwd, path, file.content);
    if (this.isSvg()) this.reader.load();
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
}
