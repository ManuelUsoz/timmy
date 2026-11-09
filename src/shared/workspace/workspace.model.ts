import { Schema } from 'effect';
import { ProjectId } from '../projects/projects.model';
import { Provider } from '../settings/settings.model';
import { TerminalId } from '../terminal/terminal.model';

/** A Tab of a Project (GLOSSARY: Tab). */
export const TabId = Schema.String.pipe(Schema.brand('TabId'));
export type TabId = typeof TabId.Type;

export const PaneId = Schema.String.pipe(Schema.brand('PaneId'));
export type PaneId = typeof PaneId.Type;

export const SplitDirection = Schema.Literals(['right', 'down']).annotate({ identifier: 'SplitDirection' });
export type SplitDirection = typeof SplitDirection.Type;

/** A Pane: its Views in Stack order, and the one expanded. A Pane with one View is not a Stack. */
export const Pane = Schema.Struct({
  id: PaneId,
  views: Schema.Array(TerminalId),
  expanded: TerminalId,
}).annotate({ identifier: 'Pane' });
export type Pane = typeof Pane.Type;

export type LayoutNode =
  | { readonly kind: 'pane'; readonly pane: Pane }
  /** Children side by side (`right`) or one above the other (`down`); `sizes` are their shares, adding up to 1. */
  | { readonly kind: 'split'; readonly direction: SplitDirection; readonly children: ReadonlyArray<LayoutNode>; readonly sizes: ReadonlyArray<number> };

/** What a layout looks like on the wire and in the store, before its ids are branded. */
export type LayoutNodeEncoded =
  | { readonly kind: 'pane'; readonly pane: typeof Pane.Encoded }
  | { readonly kind: 'split'; readonly direction: SplitDirection; readonly children: ReadonlyArray<LayoutNodeEncoded>; readonly sizes: ReadonlyArray<number> };

/** A split needs at least two children and one share (a positive number) for each: anything else cannot be laid out. */
const wellFormedSplit = Schema.makeFilter<{ readonly children: ReadonlyArray<unknown>; readonly sizes: ReadonlyArray<number> }>(
  ({ children, sizes }) => children.length >= 2 && sizes.length === children.length && sizes.every((size) => Number.isFinite(size) && size > 0),
  { expected: 'a split with a positive share for each of at least two children' },
);

export const LayoutNode: Schema.Codec<LayoutNode, LayoutNodeEncoded> = Schema.Union([
  Schema.Struct({ kind: Schema.Literal('pane'), pane: Pane }),
  Schema.Struct({
    kind: Schema.Literal('split'),
    direction: SplitDirection,
    children: Schema.Array(Schema.suspend((): Schema.Codec<LayoutNode, LayoutNodeEncoded> => LayoutNode)),
    sizes: Schema.Array(Schema.Number),
  }).pipe(Schema.check(wellFormedSplit)),
]);

/** The Panes of a Tab, how they split its area, and the focused one. */
export const TabLayout = Schema.Struct({
  root: LayoutNode,
  /** One Pane is focused at a time; it is the one shown below `lg`. */
  focused: PaneId,
}).annotate({ identifier: 'TabLayout' });
export type TabLayout = typeof TabLayout.Type;

/**
 * A Terminal as it is saved (ADR 0011): enough to show it Idle in its place and start it on demand. Its process and its
 * output are never saved. The id is its identity across restarts.
 */
export const SavedTerminal = Schema.Struct({
  terminalId: TerminalId,
  /** Its position among the Terminals the Project has had, which names it ("Terminal 2"). */
  number: Schema.Int,
  /** The Provider whose CLI it runs; absent for a plain shell. */
  provider: Schema.optionalKey(Provider),
}).annotate({ identifier: 'SavedTerminal' });
export type SavedTerminal = typeof SavedTerminal.Type;

/** A Tab as it is saved: the Terminals in it (in the order they were opened), their layout, and the name the user gave it. */
export const SavedTab = Schema.Struct({
  tabId: TabId,
  /** The name the user gave it; absent while it takes its first Terminal's. */
  name: Schema.optionalKey(Schema.String),
  terminals: Schema.Array(SavedTerminal),
  /** Absent only when the layout saved could not be read: the Tab then gets the default one. */
  layout: Schema.optionalKey(TabLayout),
}).annotate({ identifier: 'SavedTab' });
export type SavedTab = typeof SavedTab.Type;

/** The saved Tabs of one Project, in the order they were opened. */
export const ProjectLayout = Schema.Struct({
  projectId: ProjectId,
  tabs: Schema.Array(SavedTab),
}).annotate({ identifier: 'ProjectLayout' });
export type ProjectLayout = typeof ProjectLayout.Type;
