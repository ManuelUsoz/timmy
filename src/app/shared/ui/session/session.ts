import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { PermissionOption, PermissionRequest, PermissionResponse } from '../../../../shared/chat/permission.model';
import { AvatarComponent } from '../avatar/avatar';
import { ButtonComponent } from '../button/button';
import { ListRow } from '../list-row/list-row';
import { StateComponent, StateTone } from '../state/state';
import { TreeNode } from '../tree-view/tree-view.types';
import { TreeViewComponent } from '../tree-view/tree-view';

export type SessionStatus = 'live' | 'asks' | 'alert' | 'done' | 'idle';

const TONES: Record<SessionStatus, StateTone> = {
  live: 'success',
  asks: 'warning',
  alert: 'error',
  done: 'merged',
  idle: 'idle',
};

@Component({
  selector: 'ui-session',
  imports: [AvatarComponent, ButtonComponent, ListRow, StateComponent, TreeViewComponent],
  templateUrl: './session.html',
  styleUrl: './session.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionComponent {
  readonly title = input.required<string>();
  /** Branch · agent. */
  readonly sub = input('');
  readonly status = input<SessionStatus>('idle');
  readonly elapsed = input('');
  readonly tools = input<readonly TreeNode[]>([]);
  readonly permission = input<PermissionRequest | null>(null);

  /** Emits the wire decision for the pending permission request. */
  readonly answer = output<PermissionResponse>();
  readonly interrupt = output<void>();

  protected readonly tone = computed(() => TONES[this.status()]);
  protected readonly asks = computed(() => this.status() === 'asks' || this.permission() !== null);

  protected option(kinds: readonly PermissionOption['kind'][]): PermissionOption | undefined {
    return this.permission()?.options.find((o) => kinds.includes(o.kind));
  }

  protected choose(kinds: readonly PermissionOption['kind'][]): void {
    const request = this.permission();
    const opt = this.option(kinds);
    if (!request || !opt) return;
    this.answer.emit({ _tag: 'Selected', requestId: request.id, optionId: opt.id });
  }
}
