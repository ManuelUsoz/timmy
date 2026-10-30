import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ChipStripComponent, ChipStripItem } from './chip-strip';

@Component({
  imports: [ChipStripComponent],
  template: `<ui-chip-strip
    label="ascua"
    groupLabel="Sessions in ascua"
    [items]="items"
    [selectedId]="selectedId()"
    (selected)="picked.push($event)"
  />`,
})
class Host {
  items: ChipStripItem[] = [
    { id: 'a', label: 'reply-bubble', status: 'live' },
    { id: 'b', label: 'feat/voice', branch: true, status: 'live' },
    { id: 'c', label: 'api-gateway', status: 'asks' },
  ];
  selectedId = signal<string | null>('a');
  picked: string[] = [];
}

describe('ChipStripComponent', () => {
  async function render() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    const root = fixture.nativeElement.querySelector('ui-chip-strip') as HTMLElement;
    const chips = () => Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
    return { fixture, host: fixture.componentInstance, root, chips };
  }

  it('is a labelled group of buttons', async () => {
    const { root, chips } = await render();
    expect(root.getAttribute('role')).toBe('group');
    expect(root.getAttribute('aria-label')).toBe('Sessions in ascua');
    expect(chips().map((c) => c.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'reply-bubble',
      'feat/voice',
      'api-gateway ASKS',
    ]);
  });

  it('marks only the selected chip as pressed', async () => {
    const { fixture, host, chips } = await render();
    expect(chips().map((c) => c.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    host.selectedId.set('b');
    await fixture.whenStable();
    expect(chips().map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
  });

  it('emits the id when a chip is clicked', async () => {
    const { host, chips } = await render();
    chips()[2].click();
    expect(host.picked).toEqual(['c']);
  });
});
