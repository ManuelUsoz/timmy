import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { I18n } from '../../core/i18n';
import { MIN_PANE, canSplit, focusPane, panesOf, resizeSplit, type LayoutNode, type PaneId, type SplitDirection } from './pane-layout';
import { PaneStack } from './pane-stack';
import type { Tab } from './tabs';
import { TabsState } from './tabs-state';
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

/** A node of the layout with where it sits, so a divider knows which split it resizes. */
interface Placed {
  readonly node: LayoutNode;
  readonly path: ReadonlyArray<number>;
}

/**
 * The Panes of a Tab, laid out as its splits say, with a draggable divider between neighbours. It only lays them out
 * and lets the user resize and focus them: each Pane (`PaneStack`) applies the split, stack and close rules itself.
 * Below `lg` only the focused Pane shows, full size; the layout is untouched, so widening the window brings it back.
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
  }

  protected childrenOf(placed: Placed): ReadonlyArray<Placed> {
    return placed.node.kind === 'split' ? placed.node.children.map((node, index) => ({ node, path: [...placed.path, index] })) : [];
  }

  /** A click or keyboard focus anywhere in a Pane focuses it. */
  protected focus(id: PaneId): void {
    if (this.layout()?.focused !== id) this.tabs.update(this.tab(), (layout) => focusPane(layout, id));
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
}
