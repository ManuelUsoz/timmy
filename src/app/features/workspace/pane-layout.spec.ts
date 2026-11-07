import { TerminalId } from './terminal-entries';
import {
  MAX_PANES,
  MAX_VIEWS,
  PaneId,
  addToStack,
  canSplit,
  canStack,
  canUnstack,
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

describe('placing a Terminal the layout already shows', () => {
  it('moves it rather than showing it twice', () => {
    const p1 = PaneId.make('t1');
    const shown = inStep(singlePane(t(1)), [t(1), t(2)])!;
    expect(panesOf(split(shown, p1, 'down', t(2))).flatMap((pane) => pane.views)).toEqual([t(1), t(2)]);
    expect(panesOf(addToStack(shown, p1, t(2))).map((pane) => pane.views)).toEqual([[t(1), t(2)]]);
  });
});
