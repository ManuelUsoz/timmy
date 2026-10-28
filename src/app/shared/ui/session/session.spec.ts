import { TestBed } from '@angular/core/testing';
import { PermissionRequest, PermissionResponse } from '../../../../shared/chat/permission.model';
import { SessionComponent } from './session';

const request = {
  id: 'req1',
  agentId: 'ag1',
  toolCall: {
    id: 'tc1',
    agentId: 'ag1',
    name: 'Bash',
    kind: 'Execute',
    title: 'rm -rf dist',
    status: 'Pending',
    locations: [],
    diffs: [],
  },
  options: [
    { id: 'o1', label: 'Allow', kind: 'AllowOnce' },
    { id: 'o2', label: 'Always', kind: 'AllowAlways' },
    { id: 'o3', label: 'Deny', kind: 'RejectOnce' },
  ],
} as unknown as PermissionRequest;

function setup(permission: PermissionRequest | null) {
  const fixture = TestBed.createComponent(SessionComponent);
  fixture.componentRef.setInput('title', 'Fix bug');
  fixture.componentRef.setInput('permission', permission);
  fixture.detectChanges();
  return { el: fixture.nativeElement as HTMLElement, cmp: fixture.componentInstance };
}

describe('SessionComponent', () => {
  it('hides the permission card without a request', () => {
    const { el } = setup(null);
    expect(el.querySelector('.session__perm')).toBeNull();
  });

  it('shows the command and emits the selected option', () => {
    const { el, cmp } = setup(request);
    const out: PermissionResponse[] = [];
    cmp.answer.subscribe((r) => out.push(r));
    expect(el.querySelector('.session__cmd')?.textContent).toContain('rm -rf dist');
    (el.querySelector('[data-action="always"]') as HTMLElement).click();
    (el.querySelector('[data-action="deny"]') as HTMLElement).click();
    expect(out).toEqual([
      { _tag: 'Selected', requestId: 'req1' as never, optionId: 'o2' as never },
      { _tag: 'Selected', requestId: 'req1' as never, optionId: 'o3' as never },
    ]);
  });

  it('emits interrupt', () => {
    const { el, cmp } = setup(request);
    let n = 0;
    cmp.interrupt.subscribe(() => n++);
    (el.querySelector('[data-action="interrupt"]') as HTMLElement).click();
    expect(n).toBe(1);
  });
});
