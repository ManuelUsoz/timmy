import type { StateTone } from '../state/state';

export type TreeNodeStatus = 'done' | 'running';

export interface TreeNodeBadge {
  readonly label: string;
  readonly tone?: StateTone;
}

export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly children?: readonly TreeNode[];
  readonly disabled?: boolean;
  /** Activity variant: leading status icon (check / spinner). Groups without a status get a dot. */
  readonly status?: TreeNodeStatus;
  /** Activity variant: trailing mono text (target, count, elapsed time). */
  readonly meta?: string;
  /** Activity variant: state label with dot, shown before meta. */
  readonly badge?: TreeNodeBadge;
  /** Initial open state of a group. */
  readonly expanded?: boolean;
  /** Default variant: draws a folder or file icon before the label. */
  readonly kind?: 'folder' | 'file';
  /** Default variant: the node is drawn muted (for example an ignored folder). */
  readonly dimmed?: boolean;
  /** Default variant: a short mark after the label, with its accessible name. */
  readonly flag?: { readonly text: string; readonly label: string };
}
