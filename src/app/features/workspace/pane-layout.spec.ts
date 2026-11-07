import { TerminalId } from './terminal-entries';
import {
  MAX_PANES,
  MAX_VIEWS,
  PaneId,
  addToStack,
  canDrop,
  canSplit,
  canStack,
  canUnstack,
  dropView,
  focusPane,
  inStep,
  moveView,
  paneRects,
  panesOf,
  reorderView,
  replaceTerminal,
  resizeSplit,
  showView,
  singlePane,
  split,
  terminalsOfPane,
  unstack,
  withoutTerminal,
} from './pane-layout';

const t = (n: number) => TerminalId.make(`t${n}`);

describe('Panes of a Tab', () => {
  it('starts as one Pane showing the Tab\'s Terminal', () => {
    const layout = singlePane(t(1));
    expect(panesOf(layout).map((pane) => pane.views)).toEqual([[t(1)]]);
    expect(layout.focused).toBe(PaneId.make('t1'));
  });

  it('splits a Pane right or down, putting the new Terminal in a new, focused Pane', () => {
    const right = split(singlePane(t(1)), PaneId.make('t1'), 'right', t(2));
    expect(panesOf(right).map((pane) => pane.views)).toEqual([[t(1)], [t(2)]]);
    expect(right.focused).toBe(PaneId.make('t2'));
    expect(right.root).toMatchObject({ kind: 'split', direction: 'right', sizes: [0.5, 0.5] });
    const down = split(right, PaneId.make('t1'), 'down', t(3));
    expect(panesOf(down).map((pane) => pane.views)).toEqual([[t(1)], [t(3)], [t(2)]]);
    expect(down.root).toMatchObject({ kind: 'split', direction: 'right', children: [{ kind: 'split', direction: 'down' }, { kind: 'pane' }] });
  });

  it('gives each Pane its share of the Tab', () => {
    const layout = split(split(singlePane(t(1)), PaneId.make('t1'), 'right', t(2)), PaneId.make('t2'), 'down', t(3));
    expect(paneRects(layout)).toEqual(
      new Map([
        [PaneId.make('t1'), { x: 0, y: 0, width: 0.5, height: 1 }],
        [PaneId.make('t2'), { x: 0.5, y: 0, width: 0.5, height: 0.5 }],
        [PaneId.make('t3'), { x: 0.5, y: 0.5, width: 0.5, height: 0.5 }],
      ]),
    );
  });

  it('allows at most 6 Panes, and no split that leaves a Pane below its minimum size', () => {
    // Room enough that only the count can stop the sixth split: each split halves the newest Pane.
    const area = { width: 4000, height: 2000 };
    let layout = singlePane(t(1));
    for (let n = 2; n <= 6; n++) {
      expect(canSplit(layout, PaneId.make(`t${n - 1}`), n % 2 === 0 ? 'right' : 'down', area)).toBe(true);
      layout = split(layout, PaneId.make(`t${n - 1}`), n % 2 === 0 ? 'right' : 'down', t(n));
    }
    expect(panesOf(layout)).toHaveLength(MAX_PANES);
    expect(canSplit(layout, PaneId.make('t1'), 'down', area)).toBe(false);
    // 400 px wide halves to 200, below the 240 px minimum; 900 px tall halves to 450.
    const narrow = singlePane(t(1));
    expect(canSplit(narrow, PaneId.make('t1'), 'right', { width: 400, height: 900 })).toBe(false);
    expect(canSplit(narrow, PaneId.make('t1'), 'down', { width: 400, height: 900 })).toBe(true);
  });
});

describe('Stacks', () => {
  const p1 = PaneId.make('t1');
  const full = () => addToStack(addToStack(singlePane(t(1)), p1, t(2)), p1, t(3));

  it('adds up to 3 Views to a Pane, expanding the one added', () => {
    const layout = addToStack(singlePane(t(1)), p1, t(2));
    expect(panesOf(layout)).toEqual([{ id: p1, views: [t(1), t(2)], expanded: t(2) }]);
    expect(canStack(layout, p1)).toBe(true);
    expect(canStack(full(), p1)).toBe(false);
    expect(panesOf(full())[0].views).toHaveLength(MAX_VIEWS);
  });

  it('shows the View at a position (Alt+1–3), ignoring a position with no View', () => {
    expect(panesOf(showView(full(), p1, 0))[0].expanded).toBe(t(1));
    expect(panesOf(showView(addToStack(singlePane(t(1)), p1, t(2)), p1, 2))[0].expanded).toBe(t(2));
  });

  it('moves a View one place up or down (Alt+Shift+↑/↓), staying put at the ends', () => {
    expect(panesOf(moveView(full(), p1, t(3), -1))[0].views).toEqual([t(1), t(3), t(2)]);
    expect(panesOf(moveView(full(), p1, t(1), 1))[0].views).toEqual([t(2), t(1), t(3)]);
    expect(panesOf(moveView(full(), p1, t(1), -1))[0].views).toEqual([t(1), t(2), t(3)]);
    expect(panesOf(moveView(full(), p1, t(3), 1))[0].views).toEqual([t(1), t(2), t(3)]);
  });

  it('reorders a View by dropping it at another place (dragging its header)', () => {
    expect(panesOf(reorderView(full(), p1, t(1), 2))[0].views).toEqual([t(2), t(3), t(1)]);
    expect(panesOf(reorderView(full(), p1, t(3), 0))[0].views).toEqual([t(3), t(1), t(2)]);
  });

  it('moves a View out of its Stack into a new Pane beside it (Alt+Shift+Enter), not at 6 Panes', () => {
    const layout = unstack(full(), p1, t(2));
    expect(panesOf(layout).map((pane) => [pane.views, pane.expanded])).toEqual([
      [[t(1), t(3)], t(3)],
      [[t(2)], t(2)],
    ]);
    expect(layout.focused).toBe(PaneId.make('t2'));
    expect(canUnstack(full(), p1)).toBe(true);
    expect(canUnstack(singlePane(t(1)), p1)).toBe(false);
    let six = full();
    for (let n = 4; n <= 8; n++) six = split(six, six.focused, 'right', t(n));
    expect(canUnstack(six, p1)).toBe(false);
  });
});

describe('closing and keeping in step with the Tab\'s Terminals', () => {
  const p = (id: string) => PaneId.make(id);
  const three = () => split(split(singlePane(t(1)), p('t1'), 'right', t(2)), p('t2'), 'down', t(3));

  it('drops a closed Terminal\'s View; an empty Pane goes and its neighbour takes its room and the focus', () => {
    const layout = withoutTerminal(three(), t(3));
    expect(layout?.root).toMatchObject({ kind: 'split', direction: 'right', sizes: [0.5, 0.5] });
    expect(panesOf(layout!).map((pane) => pane.id)).toEqual([p('t1'), p('t2')]);
    expect(layout?.focused).toBe(p('t2'));
    expect(withoutTerminal(singlePane(t(1)), t(1))).toBeUndefined();
  });

  it('gives the share of a closed Pane to the others of its split', () => {
    let layout = split(split(singlePane(t(1)), p('t1'), 'right', t(2)), p('t2'), 'right', t(3));
    expect(layout.root).toMatchObject({ sizes: [0.5, 0.25, 0.25] });
    layout = withoutTerminal(layout, t(1))!;
    expect(layout.root).toMatchObject({ sizes: [0.5, 0.5] });
  });

  it('expands the next View when the expanded one of a Stack closes', () => {
    const stack = addToStack(addToStack(singlePane(t(1)), p('t1'), t(2)), p('t1'), t(3));
    expect(panesOf(withoutTerminal(showView(stack, p('t1'), 1), t(2))!)[0]).toEqual({ id: p('t1'), views: [t(1), t(3)], expanded: t(3) });
  });

  it('lists the Terminals a Pane closes with it', () => {
    const stack = addToStack(three(), p('t2'), t(4));
    expect(terminalsOfPane(stack, p('t2'))).toEqual([t(2), t(4)]);
  });

  it('builds a layout from the Tab\'s Terminals when it has none, one Pane each, side by side', () => {
    expect(singlePane(t(1))).toEqual(inStep(undefined, [t(1)]));
    expect(panesOf(inStep(undefined, [t(1), t(2)])!).map((pane) => pane.views)).toEqual([[t(1)], [t(2)]]);
    expect(inStep(undefined, [])).toBeUndefined();
  });

  it('drops Views whose Terminal is gone and adds Terminals it does not show yet', () => {
    const layout = inStep(three(), [t(1), t(2), t(5)])!;
    expect(panesOf(layout).flatMap((pane) => pane.views)).toEqual([t(1), t(2), t(5)]);
    expect(inStep(three(), [t(1), t(2), t(3)])).toEqual(three());
  });

  it('keeps a restarted Terminal in its place under its new id', () => {
    const layout = replaceTerminal(addToStack(three(), p('t2'), t(4)), t(2), t(9));
    expect(panesOf(layout).map((pane) => [pane.views, pane.expanded])).toEqual([
      [[t(1)], t(1)],
      [[t(9), t(4)], t(4)],
      [[t(3)], t(3)],
    ]);
  });

  it('focuses a Pane, and resizes the Panes of a split', () => {
    expect(focusPane(three(), p('t1')).focused).toBe(p('t1'));
    expect(focusPane(three(), p('nope')).focused).toBe(p('t3'));
    expect(resizeSplit(three(), [], [0.3, 0.7]).root).toMatchObject({ sizes: [0.3, 0.7] });
    expect(resizeSplit(three(), [1], [0.8, 0.2]).root).toMatchObject({ sizes: [0.5, 0.5], children: [{}, { sizes: [0.8, 0.2] }] });
  });
});

describe('splitting before a Pane', () => {
  const p = (id: string) => PaneId.make(id);

  it('puts the new Pane on the left (right axis, before) or above (down axis, before)', () => {
    const left = split(singlePane(t(1)), p('t1'), 'right', t(2), 'before');
    expect(panesOf(left).map((pane) => pane.views)).toEqual([[t(2)], [t(1)]]);
    expect(left.root).toMatchObject({ kind: 'split', direction: 'right', sizes: [0.5, 0.5] });
    expect(left.focused).toBe(p('t2'));
    const up = split(left, p('t1'), 'down', t(3), 'before');
    expect(panesOf(up).map((pane) => pane.views)).toEqual([[t(2)], [t(3)], [t(1)]]);
  });

  it('takes half of the Pane\'s share when the enclosing split runs the same way', () => {
    const layout = split(split(singlePane(t(1)), p('t1'), 'right', t(2)), p('t2'), 'right', t(3), 'before');
    expect(panesOf(layout).map((pane) => pane.views)).toEqual([[t(1)], [t(3)], [t(2)]]);
    expect(layout.root).toMatchObject({ sizes: [0.5, 0.25, 0.25] });
  });
});

describe('dropping a dragged View', () => {
  const p = (id: string) => PaneId.make(id);
  const area = { width: 1600, height: 900 };
  /** t1 | t2, side by side. */
  const two = () => split(singlePane(t(1)), p('t1'), 'right', t(2));
  /** t1 | Stack of t2, t3, t4 with t4 expanded. */
  const withStack = () => addToStack(addToStack(two(), p('t2'), t(3)), p('t2'), t(4));
  const views = (layout: ReturnType<typeof two>) => panesOf(layout).map((pane) => pane.views);

  it('splits the target Pane on the edge it was dropped on, and focuses the View\'s new Pane', () => {
    const left = dropView(withStack(), t(3), p('t1'), { edge: 'left' });
    expect(views(left)).toEqual([[t(3)], [t(1)], [t(2), t(4)]]);
    expect(left.root).toMatchObject({ kind: 'split', direction: 'right', sizes: [0.25, 0.25, 0.5] });
    expect(left.focused).toBe(p('t3'));
    expect(views(dropView(withStack(), t(3), p('t1'), { edge: 'right' }))).toEqual([[t(1)], [t(3)], [t(2), t(4)]]);
    const up = dropView(withStack(), t(3), p('t1'), { edge: 'up' });
    expect(up.root).toMatchObject({ children: [{ kind: 'split', direction: 'down', sizes: [0.5, 0.5] }, { kind: 'pane' }] });
    expect(views(up)).toEqual([[t(3)], [t(1)], [t(2), t(4)]]);
    expect(views(dropView(withStack(), t(3), p('t1'), { edge: 'down' }))).toEqual([[t(1)], [t(3)], [t(2), t(4)]]);
  });

  it('moves a lone View with its Pane: the Pane it leaves goes and gives its room back', () => {
    const layout = dropView(split(two(), p('t2'), 'right', t(3)), t(1), p('t3'), { edge: 'down' });
    expect(views(layout)).toEqual([[t(2)], [t(3)], [t(1)]]);
    expect(layout.root).toMatchObject({ direction: 'right', sizes: [0.5, 0.5], children: [{ kind: 'pane' }, { kind: 'split', direction: 'down' }] });
    expect(layout.focused).toBe(p('t1'));
  });

  it('adds the View to the target\'s Stack, last or at a position, expanded and focused', () => {
    const moved = dropView(two(), t(1), p('t2'), 'stack');
    expect(panesOf(moved)).toEqual([{ id: p('t2'), views: [t(2), t(1)], expanded: t(1) }]);
    expect(moved.focused).toBe(p('t2'));
    const at = dropView(addToStack(two(), p('t2'), t(3)), t(1), p('t2'), { stackIndex: 1 });
    expect(panesOf(at)).toEqual([{ id: p('t2'), views: [t(2), t(1), t(3)], expanded: t(1) }]);
  });

  it('expands a neighbour in the Stack that lost its expanded View', () => {
    const layout = dropView(withStack(), t(4), p('t1'), 'stack');
    expect(panesOf(layout).map((pane) => [pane.views, pane.expanded])).toEqual([
      [[t(1), t(4)], t(4)],
      [[t(2), t(3)], t(3)],
    ]);
  });

  it('reorders within the View\'s own Stack at a position, as dragging a header there does', () => {
    expect(views(dropView(withStack(), t(2), p('t2'), { stackIndex: 2 }))).toEqual([[t(1)], [t(3), t(4), t(2)]]);
  });

  it('pulls a View out of its own Stack to the edge it was dropped on', () => {
    const layout = dropView(withStack(), t(4), p('t2'), { edge: 'left' });
    expect(panesOf(layout).map((pane) => [pane.views, pane.expanded])).toEqual([
      [[t(1)], t(1)],
      [[t(4)], t(4)],
      [[t(2), t(3)], t(3)],
    ]);
    expect(layout.focused).toBe(p('t4'));
  });

  it('changes nothing for a drop on the View\'s own lone Pane, or on the centre of its own Stack', () => {
    const lone = two();
    for (const place of [{ edge: 'left' }, { edge: 'down' }, 'stack', { stackIndex: 0 }] as const) {
      expect(dropView(lone, t(1), p('t1'), place)).toBe(lone);
    }
    const stack = withStack();
    expect(dropView(stack, t(3), p('t2'), 'stack')).toBe(stack);
  });

  it('changes nothing past the limits: a full Stack, 6 Panes, or a View or Pane it does not know', () => {
    const full = withStack();
    expect(dropView(full, t(1), p('t2'), 'stack')).toBe(full);
    expect(dropView(full, t(1), p('t2'), { stackIndex: 0 })).toBe(full);
    let six = full;
    for (let n = 5; n <= 8; n++) six = split(six, six.focused, 'right', t(n));
    expect(panesOf(six)).toHaveLength(MAX_PANES);
    expect(dropView(six, t(3), p('t1'), { edge: 'down' })).toBe(six);
    expect(dropView(full, t(9), p('t1'), 'stack')).toBe(full);
    expect(dropView(full, t(1), p('nope'), 'stack')).toBe(full);
  });

  it('offers a drop only where it would do something, judged without the dragged View', () => {
    const full = withStack();
    expect(canDrop(full, t(1), p('t2'), 'stack', area)).toBe(false);
    expect(canDrop(full, t(1), p('t2'), { stackIndex: 1 }, area)).toBe(false);
    expect(canDrop(full, t(1), p('t2'), { edge: 'right' }, area)).toBe(true);
    expect(canDrop(full, t(3), p('t1'), 'stack', area)).toBe(true);
    expect(canDrop(full, t(3), p('t2'), 'stack', area)).toBe(false);
    expect(canDrop(full, t(3), p('t2'), { stackIndex: 0 }, area)).toBe(true);
    expect(canDrop(full, t(3), p('t2'), { edge: 'up' }, area)).toBe(true);
    expect(canDrop(two(), t(1), p('t1'), { edge: 'up' }, area)).toBe(false);
    // 900 px wide: t1 and t2 are 450 px each, too narrow to halve; without t1, t2 takes the whole width and can.
    const narrow = { width: 900, height: 900 };
    expect(canDrop(withStack(), t(3), p('t1'), { edge: 'right' }, narrow)).toBe(false);
    expect(canDrop(two(), t(1), p('t2'), { edge: 'right' }, narrow)).toBe(true);
    let six = full;
    for (let n = 5; n <= 8; n++) six = split(six, six.focused, 'right', t(n));
    expect(canDrop(six, t(3), p('t1'), { edge: 'down' }, { width: 4000, height: 2000 })).toBe(false);
    // Moving a lone View frees its Pane, so a sixth Pane is no limit for it.
    expect(canDrop(six, t(1), p('t2'), { edge: 'down' }, { width: 4000, height: 2000 })).toBe(true);
  });
});

describe('placing a Terminal the layout already shows', () => {
  it('moves it rather than showing it twice', () => {
    const p1 = PaneId.make('t1');
    const shown = inStep(singlePane(t(1)), [t(1), t(2)])!;
    expect(panesOf(split(shown, p1, 'down', t(2))).flatMap((pane) => pane.views)).toEqual([t(1), t(2)]);
    expect(panesOf(addToStack(shown, p1, t(2))).map((pane) => pane.views)).toEqual([[t(1), t(2)]]);
  });
});
