import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MascotComponent } from '../mascot/mascot';
import { PillComponent } from './pill';

@Component({
  imports: [PillComponent, MascotComponent],
  template: `<ui-pill large label="Live">
    <ui-mascot pillLead status="Working" />
    1 terminal running
  </ui-pill>`,
})
class Host {}

describe('PillComponent: large', () => {
  async function render() {
    await TestBed.configureTestingModule({ imports: [Host] }).compileComponents();
    const fixture = TestBed.createComponent(Host);
    await fixture.whenStable();
    return fixture.nativeElement.querySelector('ui-pill') as HTMLElement;
  }

  it('is the tall variant, with the Mascot in the lead slot at the left', async () => {
    const el = await render();
    expect(el.classList).toContain('as-pill--lg');
    expect(el.querySelector('.as-pill__lead ui-mascot')).not.toBeNull();
  });

  it('still names its state in words, which the Mascot does not', async () => {
    const el = await render();
    expect(el.querySelector('.as-pill__state')?.textContent).toContain('Live');
    expect(el.querySelector('.as-pill__lead')?.getAttribute('aria-hidden')).toBe('true');
  });
});
