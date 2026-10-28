import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { TreeViewComponent } from './tree-view';
import { TreeNode } from './tree-view.types';

@Component({
  imports: [TreeViewComponent, ReactiveFormsModule],
  template: `<ui-tree-view [nodes]="nodes" [mode]="mode" [size]="size" [formControl]="ctl" />`,
})
class Host {
  nodes: TreeNode[] = [
    {
      id: 'src',
      label: 'src',
      children: [
        { id: 'a', label: 'a.ts' },
        { id: 'b', label: 'b.ts' },
      ],
    },
    { id: 'readme', label: 'README' },
  ];
  mode: 'single' | 'checkable' = 'single';
  size: 'default' | 'sm' = 'default';
  ctl = new FormControl<string | string[] | null>(null);
}

describe('TreeViewComponent', () => {
  async function render(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    const items = () =>
      Array.from(fixture.nativeElement.querySelectorAll('li')) as HTMLElement[];
    const press = async (key: string, i = 0) => {
      items()[i].dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
      await fixture.whenStable();
    };
    return { fixture, host: fixture.componentInstance, items, press };
  }

  it('single: writeValue marks aria-selected and click emits id', async () => {
    const { fixture, host, items } = await render({ ctl: new FormControl('readme') });
    expect(items().map((i) => i.getAttribute('aria-selected'))).toEqual(['false', 'true']);
    items()[0].click();
    await fixture.whenStable();
    expect(host.ctl.value).toBe('src');
    expect(items()[0].getAttribute('aria-selected')).toBe('true');
  });

  it('checkable: writeValue reflects leaves and mixed parent', async () => {
    const { fixture, host, items, press } = await render({
      mode: 'checkable',
      ctl: new FormControl(['a']),
    });
    await press('ArrowRight');
    expect(items().map((i) => i.getAttribute('aria-checked'))).toEqual([
      'mixed',
      'true',
      'false',
      'false',
    ]);
    host.ctl.setValue(['a', 'b']);
    await fixture.whenStable();
    expect(items()[0].getAttribute('aria-checked')).toBe('true');
    expect(fixture.nativeElement.querySelector('ul').getAttribute('aria-multiselectable')).toBe(
      'true',
    );
  });

  it('checkable: toggling a folder checks then unchecks all leaves', async () => {
    const { fixture, host, items } = await render({
      mode: 'checkable',
      ctl: new FormControl<string[]>([]),
    });
    items()[0].click();
    await fixture.whenStable();
    expect(host.ctl.value).toEqual(['a', 'b']);
    items()[0].click();
    await fixture.whenStable();
    expect(host.ctl.value).toEqual([]);
  });

  it('keyboard expands, moves, collapses and goes to parent', async () => {
    const { items, press } = await render();
    expect(items()[0].getAttribute('aria-expanded')).toBe('false');
    await press('ArrowRight');
    expect(items()[0].getAttribute('aria-expanded')).toBe('true');
    expect(items().length).toBe(4);
    await press('ArrowRight');
    expect(items()[1].hasAttribute('data-active')).toBe(true);
    await press('ArrowLeft', 1);
    expect(items()[0].hasAttribute('data-active')).toBe(true);
    await press('ArrowLeft');
    expect(items()[0].getAttribute('aria-expanded')).toBe('false');
    await press('End');
    expect(items()[1].hasAttribute('data-active')).toBe(true);
  });

  it('Enter selects the active row in single mode', async () => {
    const { host, press } = await render();
    await press('Enter');
    expect(host.ctl.value).toBe('src');
  });

  it('applies the sm class', async () => {
    const { fixture } = await render({ size: 'sm' });
    expect(fixture.nativeElement.querySelector('ul').classList).toContain('as-treeview--sm');
  });
});
