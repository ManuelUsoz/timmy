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
  /** Activity variant: initial open state of a group. */
  readonly expanded?: boolean;
}
