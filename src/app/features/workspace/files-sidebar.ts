import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, effect, inject, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { I18n } from '../../core/i18n';
import { TooltipComponent } from '../../shared/ui/tooltip/tooltip';
import { TreeViewComponent } from '../../shared/ui/tree-view/tree-view';
import { FilesBrowser, MIN_BROWSER_WIDTH } from './files-browser';
import { ProjectsState } from './projects-state';
import { QuickLookState } from './quick-look-state';

/** How far one arrow key moves the edge. */
const RESIZE_STEP = 16;

/**
 * The Files browser (GLOSSARY: Files browser) docked on the right of the Workspace: the Project's folder as a tree read a
 * folder at a time and a filter above it. A file picked opens as a File View in a Pane (ADR 0013): a click opens a
 * preview, a double click pins it. Space on a file's row opens the Quick look. Esc closes the sidebar. Its left edge resizes it. The state lives in `FilesBrowser`.
 */
@Component({
  selector: 'app-files-sidebar',
  imports: [FormsModule, TooltipComponent, TreeViewComponent],
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
  private readonly tree = viewChild(TreeViewComponent);
  private readonly quickLook = inject(QuickLookState);

  protected readonly minWidth = MIN_BROWSER_WIDTH;
  protected readonly projectName = computed(() => this.projects.selected()?.name ?? '');
  protected readonly filtering = computed(() => this.browser.filter().trim() !== '');

  private resizing = false;

  constructor() {
    // The filter takes the keyboard when the sidebar opens and on every Ctrl+P.
    effect(() => {
      this.browser.filterFocus();
      this.filterField()?.nativeElement.focus();
    });
    afterNextRender(() => this.filterField()?.nativeElement.focus());
    // Space is taken on its way down, before the tree (which would pick the row) or a result (which would click itself).
    const onSpace = (event: KeyboardEvent) => this.look(event);
    this.host.nativeElement.addEventListener('keydown', onSpace, { capture: true });
    inject(DestroyRef).onDestroy(() => this.host.nativeElement.removeEventListener('keydown', onSpace, { capture: true }));
  }

  /**
   * Space on the row of a file, in the tree or in the filter's results, opens the Quick look on the list that row is in.
   * In the filter field Space is a character, and on a folder it is the tree's (it opens or closes it).
   */
  private look(event: KeyboardEvent): void {
    if (event.key !== ' ' || event.ctrlKey || event.altKey || event.metaKey || !(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>('[role=treeitem][data-id], .results [role=option][data-path]');
    const path = row?.dataset['id'] ?? row?.dataset['path'];
    const files = this.browser.shownFiles();
    if (path === undefined || !files.includes(path)) return;
    event.preventDefault();
    event.stopPropagation();
    this.quickLook.open(files, path, (last) => this.backTo(last));
  }

  /** The Quick look closed on `path`: its row is the tree's highlight and has the keyboard again. */
  private backTo(path: string): void {
    this.browser.highlight(path);
    const result = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.results [role=option]')).find((option) => option.dataset['path'] === path);
    if (result !== undefined) result.focus();
    else this.tree()?.focusRow(path);
  }

  /** A double click on a file's row pins its File View (the click before it opened the preview). */
  protected pinRow(event: MouseEvent): void {
    const row = (event.target as HTMLElement | null)?.closest<HTMLElement>('[role=treeitem][data-id]');
    const path = row?.dataset['id'];
    if (path !== undefined) this.browser.pick(path, true);
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
