import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TreeViewComponent } from './tree-view';
import { TreeNode } from './tree-view.types';

@Component({
  imports: [TreeViewComponent],
  template: `<ui-tree-view size="sm" label="Files" toggleOnActivate [nodes]="nodes" />`,
})
class Host {
  nodes: TreeNode[] = [
    {
      id: 'src',
      label: 'src',
      kind: 'folder',
      expanded: true,
      children: [
        { id: 'main', label: 'main.ts', kind: 'file', flag: { text: 'M', label: 'Modified' } },
        { id: 'old', label: 'old.ts', kind: 'file', struck: true, flag: { text: 'D', label: 'Deleted', tone: 'error' } },
      ],
    },
    { id: 'lib', label: 'lib', kind: 'folder', children: [{ id: 'x', label: 'x.ts', kind: 'file' }] },
    { id: 'deps', label: 'deps', kind: 'folder', dimmed: true, children: [{ id: 'y', label: 'y.js', kind: 'file' }] },
  ];
}

describe('TreeViewComponent as a file tree', () => {
  async function render() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const items = () => Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    const labels = () => items().map((i) => i.querySelector('.as-treeitem__label')?.textContent);
    return { fixture, root, items, labels };
  }

  it('labels the tree and opens the folders that start expanded', async () => {
    const { root, labels } = await render();
    expect(root.querySelector('[role="tree"]')?.getAttribute('aria-label')).toBe('Files');
    expect(labels()).toEqual(['src', 'main.ts', 'old.ts', 'lib', 'deps']);
  });

  it('draws a folder or file icon for nodes that say what they are', async () => {
    const { items } = await render();
    expect(items()[0].querySelector('.as-treeitem__kind')).not.toBeNull();
    expect(items()[1].querySelector('.as-treeitem__kind')).not.toBeNull();
  });

  it('shows the flag of a node with its accessible name', async () => {
    const { items } = await render();
    const flag = items()[1].querySelector('.as-treeitem__flag')!;
    expect(flag.textContent?.trim()).toBe('M');
    expect(flag.getAttribute('aria-label')).toBe('Modified');
  });

  it('draws a flag in its tone, a warning without one, and strikes a node through', async () => {
    const { items } = await render();
    expect(items()[1].querySelector('.as-treeitem__flag')?.getAttribute('data-tone')).toBe('warning');
    expect(items()[1].querySelector('.as-treeitem__label--struck')).toBeNull();
    expect(items()[2].querySelector('.as-treeitem__flag')?.getAttribute('data-tone')).toBe('error');
    expect(items()[2].querySelector('.as-treeitem__label--struck')?.textContent).toBe('old.ts');
  });

  it('marks a dimmed node', async () => {
    const { items } = await render();
    expect(items()[4].hasAttribute('data-dimmed')).toBe(true);
    expect(items()[0].hasAttribute('data-dimmed')).toBe(false);
  });

  it('expands and collapses a folder by click without touching the others', async () => {
    const { fixture, items, labels } = await render();
    items()[3].click();
    await fixture.whenStable();
    expect(labels()).toEqual(['src', 'main.ts', 'old.ts', 'lib', 'x.ts', 'deps']);
    items()[0].click();
    await fixture.whenStable();
    expect(labels()).toEqual(['src', 'lib', 'x.ts', 'deps']);
  });
});
