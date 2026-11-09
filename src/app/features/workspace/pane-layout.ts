import { PaneId, type LayoutNode, type Pane, type SplitDirection, type TabLayout } from '../../../shared/workspace/workspace.model';
import type { TerminalId } from './terminal-entries';

/**
 * The layout of a Tab (GLOSSARY: Pane, View, Stack): Panes made by splitting another on any side, each showing one View or a
 * Stack of up to three. Only Terminal Views exist for now, so a View is its Terminal's id. Pure: the screen keeps the
 * layout of each Tab and applies these rules to it.
 */
export { PaneId } from '../../../shared/workspace/workspace.model';
export type { LayoutNode, Pane, SplitDirection, TabLayout } from '../../../shared/workspace/workspace.model';

export const MAX_PANES = 6;
export const MAX_VIEWS = 3;

/**
 * A Pane is named after the Terminal it was made for, so the same steps always give the same ids. A View moved out of
 * a Stack may come from the Pane that already carries its name; the new Pane then takes the next free suffix.
 */
const paneFor = (terminal: TerminalId, taken: ReadonlyArray<Pane> = []): Pane => {
  const ids = new Set(taken.map((pane) => pane.id));
  let id = PaneId.make(terminal);
  for (let n = 2; ids.has(id); n++) id = PaneId.make(`${terminal}~${n}`);
  return { id, views: [terminal], expanded: terminal };
};
const leaf = (pane: Pane): LayoutNode => ({ kind: 'pane', pane });

export const singlePane = (terminal: TerminalId): TabLayout => ({ root: leaf(paneFor(terminal)), focused: PaneId.make(terminal) });

/** The Panes, left to right and top to bottom. */
export const panesOf = (layout: TabLayout): ReadonlyArray<Pane> => {
  const walk = (node: LayoutNode): ReadonlyArray<Pane> => (node.kind === 'pane' ? [node.pane] : node.children.flatMap(walk));
  return walk(layout.root);
};

/** Where a Pane sits, as shares of the Tab's area (0 to 1). */
export interface PaneRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export const paneRects = (layout: TabLayout): ReadonlyMap<PaneId, PaneRect> => {
  const rects = new Map<PaneId, PaneRect>();
  const walk = (node: LayoutNode, rect: PaneRect): void => {
    if (node.kind === 'pane') {
      rects.set(node.pane.id, rect);
      return;
    }
    let offset = 0;
    node.children.forEach((child, index) => {
      const share = node.sizes[index];
      walk(
        child,
        node.direction === 'right'
          ? { x: rect.x + offset * rect.width, y: rect.y, width: share * rect.width, height: rect.height }
          : { x: rect.x, y: rect.y + offset * rect.height, width: rect.width, height: share * rect.height },
      );
      offset += share;
    });
  };
  walk(layout.root, { x: 0, y: 0, width: 1, height: 1 });
  return rects;
};

/** The smallest a Pane may get, in px: a split that would leave either half smaller is not offered. */
export const MIN_PANE = { width: 240, height: 120 } as const;

/** Whether the Pane can split that way in a Tab of this size (px): under the Pane limit, and both halves big enough. */
export const canSplit = (layout: TabLayout, id: PaneId, direction: SplitDirection, area: { readonly width: number; readonly height: number }): boolean => {
  const rect = paneRects(layout).get(id);
  if (rect === undefined || panesOf(layout).length >= MAX_PANES) return false;
  return direction === 'right' ? (rect.width * area.width) / 2 >= MIN_PANE.width : (rect.height * area.height) / 2 >= MIN_PANE.height;
};

/** Replaces the Pane's node with what `change` makes of it; the rest of the tree is untouched. */
const mapPaneNode = (node: LayoutNode, id: PaneId, change: (node: LayoutNode & { kind: 'pane' }) => LayoutNode): LayoutNode =>
  node.kind === 'pane' ? (node.pane.id === id ? change(node) : node) : { ...node, children: node.children.map((child) => mapPaneNode(child, id, change)) };

/** Which side of the Pane a split puts the new one on, along its axis: `before` is left (`right`) or above (`down`). */
export type SplitSide = 'before' | 'after';

/**
 * Puts the Terminal in a new Pane beside (`right`) or below (`down`) the given one, or on the left or above it with
 * `before`, and focuses it. Splitting along the direction of the enclosing split adds a sibling that takes half of the
 * Pane's share; otherwise the Pane becomes a split. A Terminal the layout already shows moves there; nothing changes if
 * that would take the Pane itself away.
 */
export const split = (layout: TabLayout, id: PaneId, direction: SplitDirection, terminal: TerminalId, side: SplitSide = 'after'): TabLayout => {
  const base = elsewhere(layout, id, terminal);
  if (base === undefined) return layout;
  const added = paneFor(terminal, panesOf(base));
  const insert = (node: LayoutNode): LayoutNode => {
    if (node.kind === 'pane') {
      const children = side === 'before' ? [leaf(added), node] : [node, leaf(added)];
      return node.pane.id === id ? { kind: 'split', direction, children, sizes: [0.5, 0.5] } : node;
    }
    const index = node.children.findIndex((child) => child.kind === 'pane' && child.pane.id === id);
    if (index >= 0 && node.direction === direction) {
      const half = node.sizes[index] / 2;
      const at = side === 'before' ? index : index + 1;
      return {
        ...node,
        children: [...node.children.slice(0, at), leaf(added), ...node.children.slice(at)],
        sizes: [...node.sizes.slice(0, index), half, half, ...node.sizes.slice(index + 1)],
      };
    }
    return { ...node, children: node.children.map(insert) };
  };
  return { root: insert(base.root), focused: added.id };
};

const paneOf = (layout: TabLayout, id: PaneId): Pane | undefined => panesOf(layout).find((pane) => pane.id === id);

/** Changes one Pane; a Pane id that is not in the layout leaves it as it is. */
const updatePane = (layout: TabLayout, id: PaneId, change: (pane: Pane) => Pane): TabLayout => ({
  ...layout,
  root: mapPaneNode(layout.root, id, (node) => leaf(change(node.pane))),
});

export const canStack = (layout: TabLayout, id: PaneId): boolean => (paneOf(layout, id)?.views.length ?? MAX_VIEWS) < MAX_VIEWS;

/**
 * "Add to stack": the Terminal joins the Pane's Stack, last (or at position `at`), and is the View expanded. Nothing happens to a full Stack.
 * A Terminal the layout already shows moves there.
 */
export const addToStack = (layout: TabLayout, id: PaneId, terminal: TerminalId, at = MAX_VIEWS): TabLayout => {
  const base = elsewhere(layout, id, terminal);
  return base !== undefined && canStack(base, id)
    ? { ...updatePane(base, id, (pane) => ({ ...pane, views: [...pane.views.slice(0, at), terminal, ...pane.views.slice(at)], expanded: terminal })), focused: id }
    : layout;
};

/** The layout without the Terminal's View, so placing it again moves it; undefined if the target Pane would go with it. */
const elsewhere = (layout: TabLayout, id: PaneId, terminal: TerminalId): TabLayout | undefined => {
  const base = withoutTerminal(layout, terminal);
  return base === undefined || paneOf(base, id) === undefined ? undefined : base;
};

/** Alt+1–3: expands the View at that position (0-based); a position with no View changes nothing. */
export const showView = (layout: TabLayout, id: PaneId, index: number): TabLayout =>
  updatePane(layout, id, (pane) => {
    const view = pane.views[index];
    return view === undefined ? pane : { ...pane, expanded: view };
  });

/** Puts a View at another place of its Stack, the others keeping their order. */
export const reorderView = (layout: TabLayout, id: PaneId, view: TerminalId, to: number): TabLayout =>
  updatePane(layout, id, (pane) => {
    if (!pane.views.includes(view)) return pane;
    const rest = pane.views.filter((other) => other !== view);
    const at = Math.max(0, Math.min(to, rest.length));
    return { ...pane, views: [...rest.slice(0, at), view, ...rest.slice(at)] };
  });

/** Alt+Shift+↑/↓: one place up (-1) or down (1); at either end it stays. */
export const moveView = (layout: TabLayout, id: PaneId, view: TerminalId, delta: -1 | 1): TabLayout => {
  const index = paneOf(layout, id)?.views.indexOf(view) ?? -1;
  return index < 0 ? layout : reorderView(layout, id, view, index + delta);
};

export const canUnstack = (layout: TabLayout, id: PaneId): boolean => (paneOf(layout, id)?.views.length ?? 0) > 1 && panesOf(layout).length < MAX_PANES;

/** Alt+Shift+Enter: the View leaves its Stack for a new Pane to the right, which is focused. The Stack expands its first View left. */
export const unstack = (layout: TabLayout, id: PaneId, view: TerminalId): TabLayout => {
  const pane = paneOf(layout, id);
  if (pane === undefined || !pane.views.includes(view) || !canUnstack(layout, id)) return layout;
  const left = updatePane(layout, id, (current) => {
    const views = current.views.filter((other) => other !== view);
    return { ...current, views, expanded: current.expanded === view ? views[0] : current.expanded };
  });
  return split(left, id, 'right', view);
};

/** An edge of a Pane a dragged View can be dropped on, to split the Pane that way. */
export type DropEdge = 'left' | 'right' | 'up' | 'down';

/**
 * Where a dragged View lands on a Pane: on an edge (a new Pane on that side), in the centre (`stack`: last in its Stack),
 * or on its row of headers (`stackIndex`: at that position of the Stack).
 */
export type DropPlace = { readonly edge: DropEdge } | 'stack' | { readonly stackIndex: number };

const axisOf = (edge: DropEdge): SplitDirection => (edge === 'left' || edge === 'right' ? 'right' : 'down');
const sideOf = (edge: DropEdge): SplitSide => (edge === 'left' || edge === 'up' ? 'before' : 'after');
const holderOf = (layout: TabLayout, view: TerminalId): Pane | undefined => panesOf(layout).find((pane) => pane.views.includes(view));

/**
 * Whether dropping the View there would do something: judged on the layout without the View, since it leaves its place.
 * Its own lone Pane and the centre of its own Stack change nothing; an edge needs room to split, a Stack room for one more.
 */
export const canDrop = (
  layout: TabLayout,
  view: TerminalId,
  target: PaneId,
  place: DropPlace,
  area: { readonly width: number; readonly height: number },
): boolean => {
  const from = holderOf(layout, view);
  const base = elsewhere(layout, target, view);
  if (from === undefined || base === undefined) return false;
  if (place === 'stack') return from.id !== target && canStack(base, target);
  if ('stackIndex' in place) return from.id === target || canStack(base, target);
  return canSplit(base, target, axisOf(place.edge), area);
};

/**
 * A View's header was dragged and dropped on a Pane of the same Tab: the View leaves its Pane (a Pane left empty goes, a
 * Stack that loses its expanded View expands a neighbour) for a new Pane on that edge, which takes half of the target's
 * room, or for the target's Stack. The View lands expanded and its Pane focused. Within its own Stack a position reorders
 * it. A drop that would change nothing, or go past the Pane or Stack limits, leaves the layout as it is.
 */
export const dropView = (layout: TabLayout, view: TerminalId, target: PaneId, place: DropPlace): TabLayout => {
  const from = holderOf(layout, view);
  if (from === undefined || paneOf(layout, target) === undefined) return layout;
  const own = from.id === target;
  if (own && from.views.length === 1) return layout;
  if (place === 'stack') return own ? layout : addToStack(layout, target, view);
  if ('stackIndex' in place) return own ? reorderView(layout, target, view, place.stackIndex) : addToStack(layout, target, view, place.stackIndex);
  const base = elsewhere(layout, target, view);
  return base === undefined || panesOf(base).length >= MAX_PANES ? layout : split(layout, target, axisOf(place.edge), view, sideOf(place.edge));
};

export const focusPane = (layout: TabLayout, id: PaneId): TabLayout => (paneOf(layout, id) === undefined ? layout : { ...layout, focused: id });

/** A divider was dragged: the split at `path` (child indexes from the root) takes these shares. */
export const resizeSplit = (layout: TabLayout, path: ReadonlyArray<number>, sizes: ReadonlyArray<number>): TabLayout => {
  const walk = (node: LayoutNode, depth: number): LayoutNode => {
    if (node.kind === 'pane') return node;
    if (depth === path.length) return sizes.length === node.children.length ? { ...node, sizes } : node;
    return { ...node, children: node.children.map((child, index) => (index === path[depth] ? walk(child, depth + 1) : child)) };
  };
  return { ...layout, root: walk(layout.root, 0) };
};

/** The Terminals that close with a Pane: every View of its Stack. */
export const terminalsOfPane = (layout: TabLayout, id: PaneId): ReadonlyArray<TerminalId> => paneOf(layout, id)?.views ?? [];

/** A split left with one child is that child; a child split along the same direction merges into its parent. */
const tidy = (node: LayoutNode): LayoutNode => {
  if (node.kind === 'pane') return node;
  const children: LayoutNode[] = [];
  const sizes: number[] = [];
  node.children.map(tidy).forEach((child, index) => {
    if (child.kind === 'split' && child.direction === node.direction) {
      child.children.forEach((grandchild, inner) => (children.push(grandchild), sizes.push(child.sizes[inner] * node.sizes[index])));
    } else {
      children.push(child);
      sizes.push(node.sizes[index]);
    }
  });
  return children.length === 1 ? children[0] : { ...node, children, sizes };
};

/**
 * A Terminal closed: its View leaves its Pane, a Pane left empty goes and its split shares out its room, and a focus
 * that was on it moves to the next Pane, else the previous. Undefined when no Pane is left.
 */
export const withoutTerminal = (layout: TabLayout, terminal: TerminalId): TabLayout | undefined => {
  const before = panesOf(layout);
  const holder = before.find((pane) => pane.views.includes(terminal));
  if (holder === undefined) return layout;
  if (holder.views.length > 1) {
    return updatePane(layout, holder.id, (pane) => {
      const index = pane.views.indexOf(terminal);
      const views = pane.views.filter((view) => view !== terminal);
      return { ...pane, views, expanded: pane.expanded === terminal ? (views[index] ?? views[index - 1]) : pane.expanded };
    });
  }
  const prune = (node: LayoutNode): LayoutNode | undefined => {
    if (node.kind === 'pane') return node.pane.id === holder.id ? undefined : node;
    const kept = node.children.map((child, index) => [prune(child), node.sizes[index]] as const).filter((pair): pair is readonly [LayoutNode, number] => pair[0] !== undefined);
    if (kept.length === 0) return undefined;
    const total = kept.reduce((sum, [, size]) => sum + size, 0);
    return { ...node, children: kept.map(([child]) => child), sizes: kept.map(([, size]) => size / total) };
  };
  const root = prune(layout.root);
  if (root === undefined) return undefined;
  const index = before.indexOf(holder);
  const focused = layout.focused === holder.id ? (before[index + 1] ?? before[index - 1]).id : layout.focused;
  return { root: tidy(root), focused };
};

/** A restarted Terminal comes back under a new id: its View keeps its place, and its expanded state. */
export const replaceTerminal = (layout: TabLayout, from: TerminalId, to: TerminalId): TabLayout => {
  const holder = panesOf(layout).find((pane) => pane.views.includes(from));
  return holder === undefined
    ? layout
    : updatePane(layout, holder.id, (pane) => ({ ...pane, views: pane.views.map((view) => (view === from ? to : view)), expanded: pane.expanded === from ? to : pane.expanded }));
};

/**
 * The layout for a Tab's Terminals as they are now: Views whose Terminal closed go, and a Terminal the layout does not
 * show yet gets a new Pane to the right of the focused one (or, at 6 Panes, a place in a Stack with room). With no layout
 * yet, each Terminal gets a Pane, side by side. Undefined for a Tab with no Terminals.
 */
export const inStep = (layout: TabLayout | undefined, terminals: ReadonlyArray<TerminalId>): TabLayout | undefined => {
  let next = layout;
  if (next !== undefined) {
    for (const view of panesOf(next).flatMap((pane) => pane.views)) {
      if (!terminals.includes(view)) next = next === undefined ? undefined : withoutTerminal(next, view);
    }
  }
  const first = next;
  for (const terminal of terminals) {
    if (next === undefined) {
      next = singlePane(terminal);
      continue;
    }
    const current: TabLayout = next;
    if (panesOf(current).some((pane) => pane.views.includes(terminal))) continue;
    const room = panesOf(current).find((pane) => pane.views.length < MAX_VIEWS);
    next =
      panesOf(current).length < MAX_PANES
        ? split(current, current.focused, 'right', terminal)
        : room === undefined
          ? current
          : addToStack(current, room.id, terminal);
  }
  // A layout built from nothing starts on its first Pane.
  return first === undefined && next !== undefined ? focusPane(next, panesOf(next)[0].id) : next;
};
