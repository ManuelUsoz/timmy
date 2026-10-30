import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TreeViewComponent } from './tree-view';
import { TreeNode } from './tree-view.types';

@Component({
  imports: [TreeViewComponent],
  template: `<ui-tree-view variant="activity" size="sm" [nodes]="nodes" />`,
})
class Host {
  nodes: TreeNode[] = [
    { id: 'read', label: 'Read', status: 'done', meta: '×4' },
    { id: 'edit', label: 'Edit', status: 'running', meta: 'hook-server.ts' },
    {
      id: 'explore',
      label: 'Explore',
      expanded: true,
      badge: { label: 'Live', tone: 'success' },
      meta: '0:18',
      children: [
        { id: 'grep', label: 'Grep', status: 'done', meta: 'announce' },
        { id: 'read2', label: 'Read', status: 'running', meta: 'pipe.ts' },
      ],
    },
    {
      id: 'plan',
      label: 'Plan',
      badge: { label: 'Done' },
      meta: '5 tools',
      children: [{ id: 'p1', label: 'Glob', status: 'done' }],
    },
  ];
}

describe('TreeViewComponent activity variant', () => {
  async function render() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const items = () => Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    return { fixture, root, items };
  }

  it('renders a tree with label and meta per item', async () => {
    const { root, items } = await render();
    expect(root.querySelector('[role="tree"]')).not.toBeNull();
    const edit = items()[1];
    expect(edit.textContent).toContain('Edit');
    expect(edit.textContent).toContain('hook-server.ts');
  });

  it('shows nested items in a group only for open parents', async () => {
    const { root, items } = await render();
    expect(root.querySelectorAll('[role="group"]').length).toBe(1);
    const explore = items().find((i) => i.textContent?.includes('Explore'))!;
    expect(explore.getAttribute('aria-expanded')).toBe('true');
    expect(explore.textContent).toContain('Live');
    expect(explore.textContent).toContain('0:18');
    expect(items().map((i) => i.querySelector('.as-treeitem__label')?.textContent)).toEqual([
      'Read',
      'Edit',
      'Explore',
      'Grep',
      'Read',
      'Plan',
    ]);
  });

  it('toggles a collapsed group on click', async () => {
    const { fixture, root, items } = await render();
    const plan = items().find((i) => i.textContent?.includes('Plan'))!;
    expect(plan.getAttribute('aria-expanded')).toBe('false');
    plan.click();
    await fixture.whenStable();
    expect(plan.getAttribute('aria-expanded')).toBe('true');
    expect(root.querySelectorAll('[role="group"]').length).toBe(2);
    expect(root.textContent).toContain('Glob');
  });

  it('toggles with Enter from the keyboard', async () => {
    const { fixture, items } = await render();
    const plan = items().find((i) => i.textContent?.includes('Plan'))!;
    plan.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    expect(plan.getAttribute('aria-expanded')).toBe('true');
  });
});
