import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { I18n } from '../../core/i18n';
import {
  MIN_PANE,
  canDrop,
  canSplit,
  dropView,
  panesOf,
  resizeSplit,
  type DropEdge,
  type DropPlace,
  type LayoutNode,
  type PaneId,
  type SplitDirection,
} from './pane-layout';
import { PaneStack, VIEW_MIME, type DropMark, type ViewDrag } from './pane-stack';
import type { Tab } from './tabs';
import { TabsState } from './tabs-state';
import { indexOfView } from './views';
import { WorkspaceLayoutState } from './workspace-layout';

/** How far one arrow key press moves a divider, in px. */
export const DIVIDER_STEP = 24;

/** The least room a node needs along a split's axis (px): its Panes side by side add up, Panes across take the largest. */
export const minAlong = (node: LayoutNode, direction: SplitDirection): number => {
  const pane = direction === 'right' ? MIN_PANE.width : MIN_PANE.height;
  if (node.kind === 'pane') return pane;
  const mins = node.children.map((child) => minAlong(child, direction));
  return node.direction === direction ? mins.reduce((sum, min) => sum + min, 0) : Math.max(...mins);
};

/**
 * The shares of a split after its divider `index` (between children `index` and `index + 1`) moved by `deltaPx`, in a
 * split `lengthPx` long. Only those two children change, and neither gets smaller than its Panes allow; a split too
 * small to honour that keeps its shares.
 */
export const dragDivider = (
  split: LayoutNode & { kind: 'split' },
  start: ReadonlyArray<number>,
  index: number,
  deltaPx: number,
  lengthPx: number,
): ReadonlyArray<number> => {
  if (lengthPx <= 0) return start;
  const pair = start[index] + start[index + 1];
  const minBefore = minAlong(split.children[index], split.direction) / lengthPx;
  const minAfter = minAlong(split.children[index + 1], split.direction) / lengthPx;
  if (minBefore + minAfter > pair) return start;
  const before = Math.min(Math.max(start[index] + deltaPx / lengthPx, minBefore), pair - minAfter);
  return start.map((size, at) => (at === index ? before : at === index + 1 ? pair - before : size));
};

/** The part of a Pane a dragged View is over: one of its edges, or its centre. */
export type DropZone = DropEdge | 'center';

/** How deep an edge zone reaches into the Pane, as a share of its width or height. */
const EDGE_SHARE = 0.25;

/**
 * The zone of the Pane at `rect` (px) under `point`: an edge in the outer quarter on that side, the nearer edge in a
 * corner, the centre elsewhere; undefined outside the Pane.
 */
export const zoneAt = (
  rect: { readonly left: number; readonly top: number; readonly width: number; readonly height: number },
  point: { readonly x: number; readonly y: number },
): DropZone | undefined => {
  const x = point.x - rect.left;
  const y = point.y - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return undefined;
  const edges = [
    { zone: 'left', distance: x, reach: rect.width },
    { zone: 'right', distance: rect.width - x, reach: rect.width },
    { zone: 'up', distance: y, reach: rect.height },
    { zone: 'down', distance: rect.height - y, reach: rect.height },
  ] as const;
  const near = edges.filter((edge) => edge.distance < edge.reach * EDGE_SHARE).sort((a, b) => a.distance - b.distance);
  return near[0]?.zone ?? 'center';
};

/** A node of the layout with where it sits, so a divider knows which split it resizes. */
interface Placed {
  readonly node: LayoutNode;
  readonly path: ReadonlyArray<number>;
}

/**
 * The Panes of a Tab, laid out as its splits say, with a draggable divider between neighbours. It lays them out, lets
 * the user resize and focus them, and takes a View whose header is dragged to another Pane (an edge, the centre, or a
 * Stack's headers); each Pane (`PaneStack`) applies the split, stack and close rules of its own header itself.
 * Below `lg` only the focused Pane shows, full size, with no drops between Panes; the layout is untouched, so widening
 * the window brings it back.
 */
@Component({
  selector: 'app-pane-grid',
  imports: [NgTemplateOutlet, PaneStack],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pane-grid.html',
  styleUrl: './pane-grid.css',
})
export class PaneGrid {
  protected readonly i18n = inject(I18n);
  private readonly tabs = inject(TabsState);
  private readonly workspace = inject(WorkspaceLayoutState);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly destroyRef = inject(DestroyRef);

  readonly tab = input.required<Tab>();
  /** The Project's folder, where the Terminals of new Panes open. */
  readonly cwd = input.required<string>();

  protected readonly layout = computed(() => this.tabs.layoutOf(this.tab()));
  protected readonly root = computed((): Placed | undefined => {
    const layout = this.layout();
    return layout === undefined ? undefined : { node: layout.root, path: [] };
  });
  protected readonly onlyFocused = computed(() => this.workspace.layout().panes === 'focused');
  protected readonly focusedPane = computed(() => {
    const layout = this.layout();
    return layout === undefined ? undefined : panesOf(layout).find((pane) => pane.id === layout.focused);
  });

  /** The grid's size in px, which decides whether a Pane has room to split. */
  private readonly size = signal({ width: 0, height: 0 });
  protected readonly splittable = computed(() => {
    const layout = this.layout();
    const size = this.size();
    const result = new Map<PaneId, { readonly right: boolean; readonly down: boolean }>();
    if (layout === undefined) return result;
    for (const pane of panesOf(layout)) {
      result.set(pane.id, { right: canSplit(layout, pane.id, 'right', size), down: canSplit(layout, pane.id, 'down', size) });
    }
    return result;
  });

  constructor() {
    afterNextRender(() => {
      const element = this.host.nativeElement;
      const measure = () => this.size.set({ width: element.clientWidth, height: element.clientHeight });
      measure();
      if (typeof ResizeObserver !== 'function') return;
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
    this.destroyRef.onDestroy(() => clearTimeout(this.pendingStart));
  }

  protected childrenOf(placed: Placed): ReadonlyArray<Placed> {
    return placed.node.kind === 'split' ? placed.node.children.map((node, index) => ({ node, path: [...placed.path, index] })) : [];
  }

  /**
   * What a split's child is tracked by: the first Pane under it. Tracking by position would rebuild the Terminals of
   * every Pane after one that is added or closed, since they all shift by one.
   */
  protected keyOf(placed: Placed): PaneId {
    let node = placed.node;
    while (node.kind === 'split') node = node.children[0];
    return node.pane.id;
  }


  protected percent(placed: Placed, index: number): number {
    return placed.node.kind === 'split' ? Math.round(placed.node.sizes[index] * 100) : 0;
  }

  /** Drags a divider: the pointer is captured, so the drag goes on outside the divider until the button is released. */
  protected startDrag(event: PointerEvent, placed: Placed, index: number): void {
    const split = placed.node;
    const container = (event.currentTarget as HTMLElement).parentElement;
    if (split.kind !== 'split' || container === null) return;
    event.preventDefault();
    const handle = event.currentTarget as HTMLElement;
    handle.setPointerCapture?.(event.pointerId);
    const rect = container.getBoundingClientRect();
    const length = split.direction === 'right' ? rect.width : rect.height;
    const origin = split.direction === 'right' ? event.clientX : event.clientY;
    const start = split.sizes;
    const move = (next: PointerEvent) => {
      const delta = (split.direction === 'right' ? next.clientX : next.clientY) - origin;
      this.resize(placed.path, dragDivider(split, start, index, delta, length));
    };
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  }

  /** Arrow keys along the divider's axis nudge it by a step. */
  protected nudge(event: KeyboardEvent, placed: Placed, index: number): void {
    const split = placed.node;
    const container = (event.currentTarget as HTMLElement).parentElement;
    if (split.kind !== 'split' || container === null) return;
    const keys = split.direction === 'right' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
    const sign = event.key === keys[0] ? -1 : event.key === keys[1] ? 1 : 0;
    if (sign === 0) return;
    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const length = split.direction === 'right' ? rect.width : rect.height;
    this.resize(placed.path, dragDivider(split, split.sizes, index, sign * DIVIDER_STEP, length));
  }

  private resize(path: ReadonlyArray<number>, sizes: ReadonlyArray<number>): void {
    this.tabs.update(this.tab(), (layout) => resizeSplit(layout, path, sizes));
  }

  // ---- Dragging a View's header to another Pane ----

  /** The View being dragged, from the moment its header starts the drag until it ends; only from `lg` up. */
  protected readonly dragging = signal<ViewDrag | undefined>(undefined);
  /** Over the grid while a View is dragged, so the Terminals underneath (xterm) do not take the drag events. */
  protected readonly overlay = computed(() => this.dragging() !== undefined && !this.onlyFocused());
  /** Where the dragged View would land, if there; undefined off the Panes or where a drop would do nothing. */
  protected readonly target = signal<DropTarget | undefined>(undefined, { equal: sameTarget });
  private pendingStart: ReturnType<typeof setTimeout> | undefined;

  /**
   * A header started a drag. The overlay comes a moment later: Chromium ends a drag at once when the page changes
   * under the pointer while the drag is starting.
   */
  protected dragStarted(drag: ViewDrag): void {
    clearTimeout(this.pendingStart);
    this.pendingStart = setTimeout(() => this.dragging.set(drag));
  }

  /** The drag ended: dropped, cancelled with Esc, or let go outside the grid. */
  protected dragEnded(): void {
    clearTimeout(this.pendingStart);
    this.dragging.set(undefined);
    this.target.set(undefined);
  }

  protected dragOver(event: DragEvent): void {
    const drag = this.dragging();
    if (drag === undefined || !(event.dataTransfer?.types ?? []).includes(VIEW_MIME)) return;
    const target = this.targetAt(drag, { x: event.clientX, y: event.clientY });
    this.target.set(target);
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = target === undefined ? 'none' : 'move';
    // Letting the event go undone is what refuses a drop: the cursor shows it.
    if (target !== undefined) event.preventDefault();
  }

  protected dragLeave(): void {
    this.target.set(undefined);
  }

  protected drop(event: DragEvent): void {
    const drag = this.dragging();
    const target = this.target();
    event.preventDefault();
    this.dragEnded();
    if (drag !== undefined && target !== undefined) this.tabs.update(this.tab(), (layout) => dropView(layout, drag.view, target.pane, target.place));
  }

  /** The Pane under the point, and where on it the View would land: a Stack's headers, else the zone of the Pane. */
  private targetAt(drag: ViewDrag, point: { readonly x: number; readonly y: number }): DropTarget | undefined {
    const layout = this.layout();
    if (layout === undefined) return undefined;
    const element = Array.from(this.host.nativeElement.querySelectorAll<HTMLElement>('.pane[data-pane]')).find((each) => contains(each.getBoundingClientRect(), point));
    const pane = panesOf(layout).find((each) => each.id === element?.dataset['pane']);
    if (element === undefined || pane === undefined) return undefined;
    const rect = element.getBoundingClientRect();
    const valid = (place: DropPlace) => canDrop(layout, drag.view, pane.id, place, this.size());
    const header = pane.views.length > 1 ? Array.from(element.querySelectorAll<HTMLElement>('.view-header[data-index]')).find((each) => contains(each.getBoundingClientRect(), point)) : undefined;
    if (header !== undefined) {
      const index = Number(header.dataset['index']);
      const from = indexOfView(pane.views, drag.view);
      if (from === index) return undefined;
      // In its own Stack the View takes the place it is dropped on, as reordering always has; from elsewhere it goes
      // before or after the header, by the half the pointer is on.
      const box = header.getBoundingClientRect();
      const side = from >= 0 ? (from > index ? 'before' : 'after') : point.y < box.top + box.height / 2 ? 'before' : 'after';
      const place = { stackIndex: from >= 0 || side === 'before' ? index : index + 1 };
      return valid(place) ? { pane: pane.id, place, mark: { index, side } } : undefined;
    }
    const zone = zoneAt(rect, point);
    if (zone === undefined) return undefined;
    const place: DropPlace = zone === 'center' ? 'stack' : { edge: zone };
    if (!valid(place)) return undefined;
    const grid = this.host.nativeElement.getBoundingClientRect();
    const whole = { left: rect.left - grid.left, top: rect.top - grid.top, width: rect.width, height: rect.height };
    return { pane: pane.id, place, preview: previewOf(whole, zone) };
  }
}

/** Where a drag would drop: the Pane and the place on it, with the rectangle that previews it or the Stack's drop line. */
interface DropTarget {
  readonly pane: PaneId;
  readonly place: DropPlace;
  readonly preview?: Box;
  readonly mark?: DropMark;
}

interface Box {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const contains = (rect: Box, point: { readonly x: number; readonly y: number }): boolean =>
  point.x >= rect.left && point.x <= rect.left + rect.width && point.y >= rect.top && point.y <= rect.top + rect.height;

const sameTarget = (a: DropTarget | undefined, b: DropTarget | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

/** What a drop in that zone would take of the Pane: the half on that side for an edge, all of it for the centre. */
const previewOf = (rect: Box, zone: DropZone): Box => {
  const halfWidth = rect.width / 2;
  const halfHeight = rect.height / 2;
  switch (zone) {
    case 'left':
      return { ...rect, width: halfWidth };
    case 'right':
      return { ...rect, left: rect.left + halfWidth, width: halfWidth };
    case 'up':
      return { ...rect, height: halfHeight };
    case 'down':
      return { ...rect, top: rect.top + halfHeight, height: halfHeight };
    case 'center':
      return rect;
  }
};
