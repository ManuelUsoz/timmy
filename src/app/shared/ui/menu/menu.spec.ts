import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MenuComponent } from './menu';
import { OptionComponent } from './option';
import { OptionGroupComponent } from './option-group';

@Component({
  imports: [MenuComponent, OptionComponent, OptionGroupComponent],
  template: `
    <ui-menu
      [multiple]="multiple"
      [loading]="loading"
      [createLabel]="createLabel"
      ariaLabel="Things"
      (selectionChange)="picks.push($event)"
      (create)="created = created + 1"
    >
      @if (grouped) {
        <ui-option-group label="Group A">
          <ui-option value="a" [selected]="selectedA" meta="m1">Alpha</ui-option>
        </ui-option-group>
        <ui-option-group label="Group B">
          <ui-option value="b">Beta</ui-option>
        </ui-option-group>
      } @else if (items) {
        <ui-option value="a" [selected]="selectedA" meta="m1">Alpha</ui-option>
        <ui-option value="b" [disabled]="true">Beta</ui-option>
        <ui-option value="c">Gamma</ui-option>
      }
    </ui-menu>
  `,
})
class Host {
  multiple = false;
  loading = false;
  createLabel: string | undefined = undefined;
  grouped = false;
  private readonly itemsSig = signal(true);
  get items(): boolean {
    return this.itemsSig();
  }
  set items(v: boolean) {
    this.itemsSig.set(v);
  }
  selectedA = false;
  picks: unknown[] = [];
  created = 0;
}

describe('MenuComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
  });

  async function render(patch: Partial<Host> = {}) {
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    return {
      fixture,
      host: fixture.componentInstance,
      menu: root.querySelector('ui-menu') as HTMLElement,
      opts: Array.from(root.querySelectorAll('ui-option')) as HTMLElement[],
    };
  }

  it('renders a listbox with options', async () => {
    const { menu, opts } = await render();
    expect(menu.getAttribute('role')).toBe('listbox');
    expect(menu.getAttribute('aria-label')).toBe('Things');
    expect(opts.length).toBe(3);
    expect(opts[0].getAttribute('role')).toBe('option');
  });

  it('single shows trailing check on selected', async () => {
    const { opts } = await render({ selectedA: true });
    expect(opts[0].getAttribute('aria-selected')).toBe('true');
    expect(opts[0].querySelector('.check')).toBeTruthy();
    expect(opts[0].querySelector('.mark')).toBeNull();
  });

  it('multiple renders marks and aria-multiselectable', async () => {
    const { menu, opts } = await render({ multiple: true, selectedA: true });
    expect(menu.getAttribute('aria-multiselectable')).toBe('true');
    expect(opts[0].querySelector('.mark svg')).toBeTruthy();
    expect(opts[2].querySelector('.mark')).toBeTruthy();
  });

  it('renders groups and meta', async () => {
    const { fixture } = await render({ grouped: true });
    const root = fixture.nativeElement as HTMLElement;
    const groups = root.querySelectorAll('ui-option-group');
    expect(groups.length).toBe(2);
    expect(groups[0].getAttribute('role')).toBe('group');
    expect(groups[0].querySelector('.header')?.textContent).toContain('Group A');
    expect(root.querySelector('.meta')?.textContent).toContain('m1');
  });

  it('shows create row and emits create', async () => {
    const { fixture, host } = await render({ createLabel: 'Create tag' });
    const row = (fixture.nativeElement as HTMLElement).querySelector('.create') as HTMLElement;
    expect(row.textContent).toContain('Create tag');
    row.click();
    expect(host.created).toBe(1);
  });

  it('shows loading status', async () => {
    const { fixture } = await render({ loading: true, items: false });
    const status = (fixture.nativeElement as HTMLElement).querySelector('[role=status]');
    expect(status?.textContent).toContain('Loading…');
    expect((fixture.nativeElement as HTMLElement).querySelector('.empty')).toBeNull();
  });

  it('shows empty label when no options', async () => {
    const { fixture } = await render({ items: false });
    expect((fixture.nativeElement as HTMLElement).querySelector('.empty')?.textContent).toContain(
      'No results',
    );
  });

  it('navigates with keys, skips disabled, and selects with Enter', async () => {
    const { fixture, host, menu, opts } = await render();
    const key = async (k: string) => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      await fixture.whenStable();
    };
    await key('ArrowDown');
    expect(opts[0].hasAttribute('data-active')).toBe(true);
    expect(menu.getAttribute('aria-activedescendant')).toBe(opts[0].id);
    await key('ArrowDown');
    expect(opts[2].hasAttribute('data-active')).toBe(true);
    await key('Home');
    expect(opts[0].hasAttribute('data-active')).toBe(true);
    await key('End');
    expect(opts[2].hasAttribute('data-active')).toBe(true);
    await key('Enter');
    expect(host.picks).toEqual(['c']);
  });

  it('reaches the create row by keyboard and Enter emits create', async () => {
    const { fixture, host, menu } = await render({ createLabel: 'Create tag' });
    const key = async (k: string) => {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      await fixture.whenStable();
    };
    const row = menu.querySelector('.create') as HTMLElement;
    await key('End');
    expect(row.hasAttribute('data-active')).toBe(true);
    expect(menu.getAttribute('aria-activedescendant')).toBe(row.id);
    await key('Enter');
    expect(host.created).toBe(1);
    expect(host.picks).toEqual([]);
  });

  it('Space picks the active option', async () => {
    const { fixture, host, menu } = await render();
    const press = (k: string) => {
      const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
      menu.dispatchEvent(e);
      return e;
    };
    press('ArrowDown');
    const e = press(' ');
    await fixture.whenStable();
    expect(e.defaultPrevented).toBe(true);
    expect(host.picks).toEqual(['a']);
  });

  it('resets activeIndex when options change', async () => {
    const { fixture, host, menu } = await render();
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    await fixture.whenStable();
    expect(menu.getAttribute('aria-activedescendant')).not.toBeNull();
    host.items = false;
    await fixture.whenStable();
    expect(menu.getAttribute('aria-activedescendant')).toBeNull();
  });

  it('click emits selectionChange, disabled does not', async () => {
    const { host, opts } = await render();
    opts[0].click();
    opts[1].click();
    expect(host.picks).toEqual(['a']);
  });
});
