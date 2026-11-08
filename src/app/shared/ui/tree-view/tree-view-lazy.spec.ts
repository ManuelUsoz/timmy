import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { TreeViewComponent } from './tree-view';
import { TreeNode } from './tree-view.types';

@Component({
  imports: [TreeViewComponent],
  template: `<ui-tree-view label="Files" toggleOnActivate [nodes]="nodes" (toggled)="events.push($event)" />`,
})
class Host {
  /** A folder whose children are not loaded yet is `lazy`: it can be opened although it has none. */
  nodes: TreeNode[] = [
    { id: 'src', label: 'src', kind: 'folder', lazy: true },
    { id: 'empty', label: 'empty', kind: 'folder', expanded: true, lazy: true, children: [] },
    { id: 'a.txt', label: 'a.txt', kind: 'file' },
  ];
  events: Array<{ id: string; open: boolean }> = [];
}

describe('TreeViewComponent with lazy folders', () => {
  async function render() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const items = () => Array.from(root.querySelectorAll<HTMLElement>('[role="treeitem"]'));
    return { fixture, host: fixture.componentInstance, items };
  }

  it('offers to open a lazy folder that has no children yet, and only that one', async () => {
    const { items } = await render();
    expect(items().map((item) => item.getAttribute('aria-expanded'))).toEqual(['false', 'true', null]);
  });

  it('says which folder was opened or closed when the user toggles it', async () => {
    const { fixture, host, items } = await render();
    items()[0].click();
    await fixture.whenStable();
    items()[0].click();
    await fixture.whenStable();
    expect(host.events).toEqual([
      { id: 'src', open: true },
      { id: 'src', open: false },
    ]);
  });

  it('does not report a file as toggled', async () => {
    const { fixture, host, items } = await render();
    items()[2].click();
    await fixture.whenStable();
    expect(host.events).toEqual([]);
  });
});
