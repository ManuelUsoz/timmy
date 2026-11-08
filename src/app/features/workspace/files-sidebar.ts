import { ChangeDetectionStrategy, Component, ElementRef, afterNextRender, computed, effect, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18n } from '../../core/i18n';
import { TreeViewComponent } from '../../shared/ui/tree-view/tree-view';
import { FilesBrowser, MIN_BROWSER_WIDTH } from './files-browser';
import { ProjectsState } from './projects-state';

/** How far one arrow key moves the edge. */
const RESIZE_STEP = 16;

/** `2.5 MB`: the size of a file too large to preview. */
const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * The Files browser (GLOSSARY: Files browser) docked on the right of the Workspace: the Project's folder as a tree read a
 * folder at a time, a filter above it, and the chosen file read in its place, with Back. Esc goes out of a file, then out of
 * the sidebar. Its left edge resizes it. The state lives in `FilesBrowser`.
 */
@Component({
  selector: 'app-files-sidebar',
  imports: [FormsModule, TreeViewComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './files-sidebar.html',
  styleUrl: './files-sidebar.css',
  host: {
    role: 'complementary',
    '[attr.aria-label]': 'i18n.t("files.title")',
    '[style.width.px]': 'browser.shownWidth()',
    '(keydown.escape)': 'escape($event)',
  },
})
export class FilesSidebar {
  protected readonly browser = inject(FilesBrowser);
  protected readonly i18n = inject(I18n);
  private readonly projects = inject(ProjectsState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly filterField = viewChild<ElementRef<HTMLInputElement>>('filterField');
  private readonly codeRegion = viewChild<ElementRef<HTMLElement>>('codeRegion');
  private readonly backButton = viewChild<ElementRef<HTMLElement>>('backButton');

  protected readonly minWidth = MIN_BROWSER_WIDTH;
  protected readonly projectName = computed(() => this.projects.selected()?.name ?? '');
  protected readonly fileName = computed(() => this.browser.selected()?.split('/').at(-1) ?? '');
  protected readonly fileDir = computed(() => this.browser.selected()?.split('/').slice(0, -1).join('/') ?? '');
  protected readonly filtering = computed(() => this.browser.filter().trim() !== '');

  /** One number per line of the open text file; a final newline does not start another line. */
  protected readonly gutter = computed(() => {
    const file = this.browser.file();
    if (file.status !== 'text' || file.content === '') return '';
    const lines = file.content.split('\n');
    const count = lines.at(-1) === '' ? lines.length - 1 : lines.length;
    return Array.from({ length: count }, (_, index) => index + 1).join('\n');
  });

  private resizing = false;

  constructor() {
    // The filter takes the keyboard when the sidebar opens, when the tree comes back, and on every Ctrl+P.
    effect(() => {
      this.browser.filterFocus();
      const field = this.filterField()?.nativeElement;
      if (field !== undefined && !field.disabled) field.focus();
    });
    afterNextRender(() => {
      const field = this.filterField()?.nativeElement;
      if (field !== undefined && !field.disabled) field.focus();
    });
    // The row that was clicked goes away with the tree, and the focus with it: a file taking its place takes the keyboard,
    // or Esc and the arrows would go nowhere. Its text when there is some (it scrolls with the arrows), the way back otherwise.
    effect(() => {
      if (this.browser.view() !== 'file') return;
      (this.codeRegion() ?? this.backButton())?.nativeElement.focus();
    });
  }

  protected size(bytes: number): string {
    return formatSize(bytes);
  }

  protected escape(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.browser.escape();
  }

  protected openFirst(): void {
    const matches = this.browser.matches();
    const first = matches.status === 'ready' ? matches.items[0] : undefined;
    if (first !== undefined) this.browser.openFile(first.path);
  }

  /** From the field, the Down arrow goes into the results; in them, the arrows walk the list. */
  protected walk(event: KeyboardEvent, from?: HTMLElement): void {
    const options = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.results [role=option]'));
    const at = from === undefined ? -1 : options.indexOf(from);
    const next = event.key === 'ArrowDown' ? options[at + 1] : at <= 0 ? this.filterField()?.nativeElement : options[at - 1];
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    next?.focus();
  }

  protected startResize(event: PointerEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    this.resizing = true;
  }

  protected resize(event: PointerEvent): void {
    if (!this.resizing) return;
    // The sidebar is docked on the right: its width is the distance from the pointer to the window's right edge.
    this.browser.setWidth(this.host.nativeElement.getBoundingClientRect().right - event.clientX);
  }

  protected endResize(): void {
    if (!this.resizing) return;
    this.resizing = false;
    this.browser.saveWidth();
  }

  protected edgeKey(event: KeyboardEvent): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    // The edge is on the left: moving it left makes the sidebar wider.
    this.browser.setWidth(this.browser.shownWidth() + (event.key === 'ArrowLeft' ? RESIZE_STEP : -RESIZE_STEP));
  }

  protected edgeKeyUp(event: KeyboardEvent): void {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') this.browser.saveWidth();
  }
}
