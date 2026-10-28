import { TestBed } from '@angular/core/testing';
import { HistoryComponent, HistoryGroup } from './history';

const groups: HistoryGroup[] = [
  {
    label: 'Today',
    items: [
      { id: 'a', title: 'Fix bug', sub: 'main', time: '2m', status: 'merged', last: 'Done.' },
      { id: 'b', title: 'Add feature', time: '1h' },
    ],
  },
  { label: 'Yesterday', items: [{ id: 'c', title: 'Refactor', time: '1d' }] },
];

function setup(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(HistoryComponent);
  for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, cmp: fixture.componentInstance };
}

describe('HistoryComponent', () => {
  it('renders groups and rows', () => {
    const { el } = setup({ groups });
    expect(el.querySelectorAll('as-list-group-label').length).toBe(2);
    expect(el.querySelectorAll('as-list-row').length).toBe(3);
    expect(el.querySelector('ui-tag')?.textContent).toContain('merged');
  });

  it('emits select on row activate', () => {
    const { el, cmp } = setup({ groups });
    const ids: string[] = [];
    cmp.select.subscribe((id) => ids.push(id));
    (el.querySelectorAll('as-list-row')[1] as HTMLElement).click();
    expect(ids).toEqual(['b']);
  });

  it('opens the selected row with actions', () => {
    const { el, cmp } = setup({ groups, selectedId: 'a' });
    const resumed: string[] = [];
    cmp.resume.subscribe((id) => resumed.push(id));
    expect(el.querySelector('.history__last')?.textContent).toContain('Done.');
    (el.querySelector('.history__actions button') as HTMLElement).click();
    expect(resumed).toEqual(['a']);
  });

  it('shows empty state and emits clearSearch', () => {
    const { el, cmp } = setup({ groups: [] });
    let cleared = 0;
    cmp.clearSearch.subscribe(() => cleared++);
    expect(el.querySelector('as-list-row')).toBeNull();
    (el.querySelector('.history__empty button') as HTMLElement).click();
    expect(cleared).toBe(1);
  });

  it('listboxes hold only options', () => {
    const { el } = setup({ groups, selectedId: 'a' });
    const boxes = el.querySelectorAll('[role="listbox"]');
    expect(boxes.length).toBe(3);
    boxes.forEach((b) => {
      expect(Array.from(b.children).every((c) => c.tagName === 'AS-LIST-ROW')).toBe(true);
    });
  });

  it('input value follows query', () => {
    const { fixture, el } = setup({ groups, query: 'abc' });
    const input = el.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('abc');
    fixture.componentRef.setInput('query', '');
    fixture.detectChanges();
    expect(input.value).toBe('');
  });

  it('clear button empties the typed input', () => {
    const { fixture, el } = setup({ groups: [] });
    const input = el.querySelector('input') as HTMLInputElement;
    input.value = 'zzz';
    (el.querySelector('.history__empty button') as HTMLElement).click();
    fixture.detectChanges();
    expect(input.value).toBe('');
  });

  it('emits filterRemove', () => {
    const { el, cmp } = setup({ groups, filters: [{ id: 'f1', label: 'repo:x' }] });
    const ids: string[] = [];
    cmp.filterRemove.subscribe((id) => ids.push(id));
    (el.querySelector('.as-chip__x') as HTMLElement).click();
    expect(ids).toEqual(['f1']);
  });
});
