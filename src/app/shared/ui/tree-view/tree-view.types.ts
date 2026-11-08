import type { StateTone } from '../state/state';

/** `agent` is a subagent or a plan: the violet dot, whatever its state (the badge says it). */
export type TreeNodeStatus = 'done' | 'running' | 'failed' | 'agent';

export interface TreeNodeBadge {
  readonly label: string;
  readonly tone?: StateTone;
}

export interface TreeNode {
  readonly id: string;
  readonly label: string;
  readonly children?: readonly TreeNode[];
  readonly disabled?: boolean;
  /** Activity variant: leading status icon (check / spinner / red cross / violet dot). Groups without a status get a dot. */
  readonly status?: TreeNodeStatus;
  /** Activity variant: trailing mono text (target, count, elapsed time). */
  readonly meta?: string;
  /** Activity variant: state label with dot, shown before meta. */
  readonly badge?: TreeNodeBadge;
  /** Initial open state of a group. */
  readonly expanded?: boolean;
  /** Default variant: a folder whose children are not loaded yet. It can be opened although it has none, and `toggled` says when. */
  readonly lazy?: boolean;
  /** Default variant: draws a folder or file icon before the label. */
  readonly kind?: 'folder' | 'file';
  /** Default variant: the node is drawn muted (for example an ignored folder). */
  readonly dimmed?: boolean;
  /** Default variant: a short mark after the label, with its accessible name. */
  readonly flag?: { readonly text: string; readonly label: string };
}
