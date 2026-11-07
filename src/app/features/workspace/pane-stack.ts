import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { Pane } from './pane-layout';
import type { Tab } from './tabs';

/**
 * One Pane of a Tab: the header of its expanded View (split right, split down, add to stack, close), the View itself,
 * and the collapsed headers of the rest of its Stack. It applies the Pane and Stack rules through `TabsState`; the grid
 * around it only lays the Panes out. STUB: the Stack track fills it in.
 */
@Component({
  selector: 'app-pane-stack',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
export class PaneStack {
  readonly tab = input.required<Tab>();
  readonly pane = input.required<Pane>();
  /** The Project's folder, where new Terminals open. */
  readonly cwd = input.required<string>();
  /** The focused Pane: its keys (Alt+1–3, Alt+Shift+…) work, and its expanded Terminal is the one on screen. */
  readonly focused = input(false);
  /** Whether Split right / Split down are offered: the grid knows the Pane's size in px (see `canSplit`). */
  readonly canSplitRight = input(false);
  readonly canSplitDown = input(false);
}
