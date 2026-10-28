import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ListGroupLabel } from './list-group-label';
import { ListRow } from './list-row';

@Component({
  imports: [ListRow, ListGroupLabel],
  template: `
    <as-list-group-label label="Today" [count]="2" />
    <as-list-row
      label="Fix bug"
      meta="main"
      [selected]="selected"
      [disabled]="disabled"
      [asks]="asks"
      [lead]="lead"
      (activate)="count = count + 1"
    >
      <i leading>L</i>
      <b trailing>T</b>
    </as-list-row>
  `,
})
class Host {
  selected = false;
  disabled = false;
  asks = false;
  lead = false;
  count = 0;
}

describe('ListRow', () => {
  async function render(patch: Partial<Host> = {}) {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    const el = fixture.nativeElement.querySelector('as-list-row') as HTMLElement;
    return { fixture, el };
  }

  it('renders label, meta and projected slots', async () => {
    const { el } = await render();
    expect(el.querySelector('.as-row__title')?.textContent).toBe('Fix bug');
    expect(el.querySelector('.as-row__sub')?.textContent).toBe('main');
    expect(el.querySelector('i')?.textContent).toBe('L');
    expect(el.querySelector('b')?.textContent).toBe('T');
  });

  it('applies selected and disabled classes', async () => {
    const { el } = await render({ selected: true, disabled: true });
    expect(el.classList).toContain('as-row--selected');
    expect(el.classList).toContain('as-row--disabled');
    expect(el.getAttribute('aria-selected')).toBe('true');
  });

  it('shows ASKS and class when asks', async () => {
    const { el } = await render({ asks: true });
    expect(el.classList).toContain('as-row--asks');
    expect(el.textContent).toContain('ASKS');
  });

  it('applies lead class', async () => {
    const { el } = await render({ lead: true });
    expect(el.classList).toContain('as-row--lead');
  });

  it('emits activate on click and Enter', async () => {
    const { fixture, el } = await render();
    el.click();
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await fixture.whenStable();
    expect(fixture.componentInstance.count).toBe(2);
  });

  it('does not emit when disabled', async () => {
    const { fixture, el } = await render({ disabled: true });
    el.click();
    expect(fixture.componentInstance.count).toBe(0);
  });

  it('renders group label text and count', async () => {
    const { fixture } = await render();
    const g = fixture.nativeElement.querySelector('as-list-group-label') as HTMLElement;
    expect(g.textContent).toContain('Today');
    expect(g.textContent).toContain('2');
  });
});
