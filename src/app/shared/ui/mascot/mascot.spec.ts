import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { TerminalStatus } from '../../../../shared/notification/notification.model';
import { MascotComponent } from './mascot';

@Component({
  imports: [MascotComponent],
  template: `<ui-mascot [status]="status" [size]="size" [label]="label" />`,
})
class Host {
  status: TerminalStatus = 'Idle';
  size = 72;
  label = '';
}

describe('MascotComponent', () => {
  async function render(patch: Partial<Host> = {}) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    Object.assign(fixture.componentInstance, patch);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('ui-mascot') as HTMLElement;
  }

  const tones: ReadonlyArray<[TerminalStatus, string]> = [
    ['Working', 'success'],
    ['Waiting', 'info'],
    ['Error', 'error'],
    ['Done', 'merged'],
    ['Idle', 'idle'],
  ];

  it.each(tones)('colors a %s Mascot with the %s tone', async (status, tone) => {
    const el = await render({ status });
    expect(el.style.getPropertyValue('--tone')).toBe(`var(--support-${tone})`);
    expect(el.getAttribute('data-status')).toBe(status);
  });

  it('draws the Mascot at the size asked', async () => {
    const svg = (await render({ size: 72 })).querySelector('svg')!;
    expect(svg.getAttribute('width')).toBe('72');
    expect(svg.getAttribute('height')).toBe('72');
  });

  it('has different eyes for the statuses that look different', async () => {
    const eyes = async (status: TerminalStatus) => (await render({ status })).querySelector('.eyes')!.innerHTML;
    const looks = new Set([await eyes('Working'), await eyes('Error'), await eyes('Done')]);
    expect(looks.size).toBe(3);
  });

  it('is decorative unless it has a label, which makes it an image', async () => {
    expect((await render()).getAttribute('aria-hidden')).toBe('true');
    const labelled = await render({ label: 'Timmy: Working' });
    expect(labelled.getAttribute('role')).toBe('img');
    expect(labelled.getAttribute('aria-label')).toBe('Timmy: Working');
    expect(labelled.getAttribute('aria-hidden')).toBeNull();
  });
});
